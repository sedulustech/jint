/**
 * Lint — the one function most consumers need. State-in/signals-out: resolves the input, derives
 * each file's element inventory, classifies every element x every inventory-scoped rule in one
 * chunked pass, unit-scoped rules over the whole unit — runs each rule's handle, streams
 * Measurements, Signals and per-unit MeasureErrors (signalled, but never run-failing).
 *
 * Files fan out in waves of at most FILE_CONCURRENCY in-flight classifier pipelines (design §7.4
 * cost control); events stream per file as its wave completes, measurements before signals.
 *
 * The pipeline never resolves paths it wasn't given, never knows about the terminal, and never
 * throws for per-unit failures (design §1, §7).
 */

import { resolveInput } from "./input/infer.ts";
import { createClassifier } from "./jev/client.ts";
import { classifyFile, type ClassifyEvent } from "./sensors/classify.ts";
import {
  MeasureError,
  SetupError,
  type InputKind,
  type Classifier,
  type LintEvent,
  type Measurement,
  type Signal,
  type Rule,
  type Unit,
} from "./types.ts";
import type { ResolvedConfig } from "../config/define.ts";

/** Max files with an in-flight classifier pipeline at once (fan-out bound, design §7.4). */
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
      for (const { event, stage, span } of result.events) {
        if (event instanceof MeasureError) {
          yield { type: "error", error: event };
          continue;
        }

        yield { type: "measurement", measurement: { ...event, stage } };
        // One pass, no candidacy: every measurement is a reading; the rule's handle is the
        // only threshold. Element readings carry their span into the signal's location.
        const handle = byName.get(event.rule)?.handle;
        const severity = handle?.(event.value) ?? null;
        if (severity !== null) {
          yield {
            type: "signal",
            signal: {
              rule: event.rule,
              input: event.input,
              value: event.value,
              severity,
              ...(span !== undefined && { location: { input: event.input, span } }),
            },
          };
        }
      }
    }
  }
}

/** One unit's pipeline outcome: streamed classification events plus the abort flag. */
interface UnitResult {
  events: ClassifyEvent[];
  abort: boolean;
}

async function runUnit(
  unit: Unit,
  rules: readonly Rule[],
  classifier: Classifier,
  isAborted: () => boolean,
): Promise<UnitResult> {
  const result = await classifyFile(unit, rules, classifier, isAborted);
  return { events: result.events, abort: result.fatal };
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
  errors: MeasureError[];
}

/** Drain the stream into the stable report shape both reporters render. */
export async function collectReport(events: AsyncIterable<LintEvent>): Promise<LintReport> {
  const report: LintReport = { measurements: [], signals: [], errors: [] };
  for await (const event of events) {
    if (event.type === "measurement") report.measurements.push(event.measurement);
    else if (event.type === "signal") report.signals.push(event.signal);
    else if (event.type === "error") report.errors.push(event.error);
  }
  return report;
}
