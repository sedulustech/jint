/**
 * lint — the one function most consumers need. State-in/signals-out: resolves
 * the input, measures each unit through the judge, runs each sensor's handle,
 * streams Measurements and Signals (and per-unit Diagnostics).
 *
 * The pipeline never resolves paths it wasn't given, never knows about the
 * terminal, and never throws for per-unit failures (design §1, §7).
 */

import type { ResolvedConfig } from "../config/define.ts";
import { AppError, type InputKind, type Judge, type LintEvent, type Measurement, type Signal, type Diagnostic, type Sensor } from "./types.ts";
import { resolveInput } from "./input/infer.ts";
import { measureUnit } from "./sensors/measure.ts";
import { createJudge } from "./jev/client.ts";

export interface LintOptions {
  config: ResolvedConfig;
  /** Input override (CLI flags); a string[] means explicit file paths. */
  input?: string | string[];
  inputType?: InputKind;
  /** Extra input exclusions, unioned with config.exclude. */
  exclude?: readonly string[];
  /** Sensors removed by name (CLI --disable). */
  disable?: readonly string[];
  /** Swappable judge; defaults to the TypeSafe System One adapter. */
  judge?: Judge;
}

export async function* lint(options: LintOptions): AsyncGenerator<LintEvent> {
  const judge = options.judge ?? createJudge();
  const input = options.input ?? options.config.input;
  if (input === "" || (Array.isArray(input) && input.length === 0)) {
    throw new AppError(
      "CONFIG_INVALID",
      "no input: pass --file/--dir/--diff or set input in jint.config.ts",
    );
  }
  const exclude = [...options.config.exclude, ...(options.exclude ?? [])];
  const sensors = pickSensors(options.config.sensors, options.disable);
  const units = resolveInput({ input, inputType: options.inputType ?? options.config.inputType, exclude });
  const byName = new Map(sensors.map((s) => [s.name, s]));

  for await (const unit of units) {
    for await (const event of measureUnit(unit, sensors, judge)) {
      if ("code" in event) {
        yield { type: "diagnostic", diagnostic: event };
        // A rejected API key fails every unit identically: abort the run after
        // surfacing the diagnostic — do not hammer the API N times.
        if (event.code === "JEV_AUTH") return;
        continue;
      }
      yield { type: "measurement", measurement: event };
      const sensor = byName.get(event.sensor);
      const severity = sensor?.handle(event.value) ?? null;
      if (severity !== null) {
        yield {
          type: "signal",
          signal: { sensor: event.sensor, input: event.input, value: event.value, severity },
        };
      }
    }
  }
}

function pickSensors(sensors: readonly Sensor[], disable: readonly string[] | undefined): readonly Sensor[] {
  if (disable === undefined || disable.length === 0) return sensors;
  const disabled = new Set(disable);
  return sensors.filter((s) => !disabled.has(s.name));
}

export interface LintReport {
  measurements: Measurement[];
  signals: Signal[];
  diagnostics: Diagnostic[];
}

/** Drain the stream into the stable report shape both reporters render. */
export async function collectReport(events: AsyncIterable<LintEvent>): Promise<LintReport> {
  const report: LintReport = { measurements: [], signals: [], diagnostics: [] };
  for await (const event of events) {
    if (event.type === "measurement") report.measurements.push(event.measurement);
    else if (event.type === "signal") report.signals.push(event.signal);
    else report.diagnostics.push(event.diagnostic);
  }
  return report;
}
