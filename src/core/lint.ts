/**
 * Lint — the one function most consumers need. State-in/signals-out: resolves the input, measures
 * each unit — files through the two-stage funnel, diffs through the legacy whole-unit path — runs
 * each rule's handle, streams Measurements, Signals, per-unit RequestErrors and degradations.
 *
 * Files fan out in waves of at most FILE_CONCURRENCY in-flight classifier pipelines (design §7.4
 * cost control); events stream per file as its wave completes, measurements before signals.
 *
 * The pipeline never resolves paths it wasn't given, never knows about the terminal, and never
 * throws for per-unit failures (design §1, §7).
 */

import { resolveInput } from "./input/infer.ts";
import { createClassifier } from "./jev/client.ts";
import {
  classifyFile,
  isHighGood,
  type ConfirmedReading,
  type FunnelEvent,
} from "./sensors/funnel.ts";
import {
  RequestError,
  SetupError,
  type Degradation,
  type InputKind,
  type Classifier,
  type LintEvent,
  type Measurement,
  type Signal,
  type Rule,
  type Unit,
} from "./types.ts";
import type { ResolvedConfig } from "../config/define.ts";

/** Max files with an in-flight funnel at once (sweep fan-out bound, design §7.4). */
const FILE_CONCURRENCY = 4;

export interface LintOptions {
  config: ResolvedConfig;
  /** Input override (CLI flags); a string[] means explicit file paths. */
  input?: string | string[];
  inputType?: InputKind;
  /** Extra input exclusions, unioned with config.exclude. */
  exclude?: readonly string[];
  /** Sensors removed by name (CLI --disable). */
  disable?: readonly string[];
  /** If set, ONLY these rules run (CLI --rule, repeatable). Applied after disable. */
  only?: readonly string[];
  /** Swappable classifier; defaults to the TypeSafe System One adapter. */
  classifier?: Classifier;
}

export async function* lint(options: LintOptions): AsyncGenerator<LintEvent> {
  const classifier = options.classifier ?? createClassifier();
  const input = options.input ?? options.config.input;
  if (input === "" || (Array.isArray(input) && input.length === 0)) {
    throw new SetupError(
      "CONFIG_INVALID",
      "no input: pass --file/--dir/--diff or set input in jint.config.ts",
    );
  }
  const exclude = [...options.config.exclude, ...(options.exclude ?? [])];
  const rules = pickRules(options.config.rules, options.disable, options.only);
  const units = await collectUnits(
    resolveInput({ input, inputType: options.inputType ?? options.config.inputType, exclude }),
  );
  const byName = new Map(rules.map((s) => [s.name, s]));
  let aborted = false;

  for (let i = 0; i < units.length && !aborted; i += FILE_CONCURRENCY) {
    const results = await Promise.all(
      units
        .slice(i, i + FILE_CONCURRENCY)
        .map((unit) => runUnit(unit, rules, classifier, () => aborted)),
    );
    for (const result of results) {
      if (result.abort) aborted = true;
      for (const { event, stage } of result.events) {
        if (event instanceof RequestError) {
          yield { type: "error", error: event };
          continue;
        }
        if ("code" in event) {
          yield { type: "degradation", degradation: event };
          continue;
        }
        yield { type: "measurement", measurement: { ...event, stage } };
        // Sweep readings are candidates; confirmed element readings decide via aggregation below.
        if (stage !== "file") continue;
        const handle = byName.get(event.rule)?.handle;
        const severity = handle?.(event.value) ?? null;
        if (severity !== null) {
          yield {
            type: "signal",
            signal: { rule: event.rule, input: event.input, value: event.value, severity },
          };
        }
      }
      // Confirmed element signals aggregate per (file, rule): max for high=bad, min for
      // high=good — never a mean (design §7.3) — and carry the extreme element's location.
      for (const [sensorName, readings] of result.confirmedBySensor) {
        const rule = byName.get(sensorName);
        if (rule === undefined) continue;
        const extreme = extremeReading(readings, isHighGood(sensorName));
        const severity = rule.handle(extreme.value);
        if (severity === null) continue;
        yield {
          type: "signal",
          signal: {
            rule: sensorName,
            input: extreme.input,
            value: extreme.value,
            severity,
            location: { input: extreme.input, span: extreme.span },
          },
        };
      }
    }
  }
}

/** One unit's pipeline outcome: streamed events plus its confirmed element readings by rule. */
interface UnitResult {
  events: FunnelEvent[];
  confirmedBySensor: Map<string, ConfirmedReading[]>;
  abort: boolean;
}

async function runUnit(
  unit: Unit,
  rules: readonly Rule[],
  classifier: Classifier,
  isAborted: () => boolean,
): Promise<UnitResult> {
  const funnel = await classifyFile(unit, rules, classifier, isAborted);
  const confirmedBySensor = new Map<string, ConfirmedReading[]>();
  for (const reading of funnel.confirmed) {
    const list = confirmedBySensor.get(reading.rule) ?? [];
    list.push(reading);
    confirmedBySensor.set(reading.rule, list);
  }
  return { events: funnel.events, confirmedBySensor, abort: funnel.fatal };
}

function extremeReading(
  readings: readonly ConfirmedReading[],
  highGood: boolean,
): ConfirmedReading {
  return readings.reduce((a, b) =>
    highGood ? (b.value < a.value ? b : a) : b.value > a.value ? b : a,
  );
}

async function collectUnits<T>(units: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const u of units) out.push(u);
  return out;
}

function pickRules(
  rules: readonly Rule[],
  disable: readonly string[] | undefined,
  only: readonly string[] | undefined,
): readonly Rule[] {
  let out = rules;
  if (disable !== undefined && disable.length > 0) {
    const disabled = new Set(disable);
    out = out.filter((s) => !disabled.has(s.name));
  }
  if (only !== undefined && only.length > 0) {
    const wanted = new Set(only);
    out = out.filter((s) => wanted.has(s.name));
  }
  return out;
}

export interface LintReport {
  measurements: Measurement[];
  signals: Signal[];
  /** Per-unit failures of the request to the classifier: the unit produced no measurement. */
  errors: RequestError[];
  /** Per-unit degradations: the unit measured, but degraded. Never fails the run. */
  degradations: Degradation[];
}

/** Drain the stream into the stable report shape both reporters render. */
export async function collectReport(events: AsyncIterable<LintEvent>): Promise<LintReport> {
  const report: LintReport = { measurements: [], signals: [], errors: [], degradations: [] };
  for await (const event of events) {
    if (event.type === "measurement") report.measurements.push(event.measurement);
    else if (event.type === "signal") report.signals.push(event.signal);
    else if (event.type === "error") report.errors.push(event.error);
    else report.degradations.push(event.degradation);
  }
  return report;
}
