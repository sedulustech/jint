/**
 * measure — compiles sensors to noul questions and batches them into ONE
 * systemOne call per state (sequential in v0). Emits Measurement { sensor,
 * input, value }: no thresholds, no handle invocation here — interpretation is
 * the handle callback's job (design §4.5).
 *
 * Per-unit failures come back as Diagnostics in the stream, never thrown past
 * the pipeline (design §7).
 */

import { AppError, type Diagnostic, type Judge, type Measurement, type QuestionSpec, type Sensor, type Unit } from "../types.ts";

/** Sensors whose inputTypes cover this unit kind — the inferred kind narrows the sensor set. */
export function sensorsFor(sensors: readonly Sensor[], kind: Unit["kind"]): Sensor[] {
  return sensors.filter((s) => s.inputTypes.includes(kind));
}

/** Compile sensors to noul questions using the calibrated structured envelope. */
export function compileQuestions(sensors: readonly Sensor[]): Record<string, QuestionSpec> {
  const questions: Record<string, QuestionSpec> = {};
  for (const sensor of sensors) {
    questions[sensor.name] = {
      type: "noul",
      instructions: {
        role: "measurement",
        dimension: sensor.name,
        claim: sensor.description,
        true_means: "the property holds in the added code",
      },
    };
  }
  return questions;
}

export async function* measureUnit(
  unit: Unit,
  sensors: readonly Sensor[],
  judge: Judge,
): AsyncGenerator<Measurement | Diagnostic> {
  const usable = sensorsFor(sensors, unit.kind);
  if (usable.length === 0) return;
  const questions = compileQuestions(usable);
  let answers: Record<string, number>;
  try {
    answers = await judge(unit.state, questions);
  } catch (e) {
    yield toDiagnostic(unit, e);
    return;
  }
  for (const sensor of usable) {
    const value = answers[sensor.name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      yield {
        input: unit.state.path,
        code: "JEV_RESPONSE_INVALID",
        message: `answer for '${sensor.name}' is missing or not a finite number`,
      };
      continue;
    }
    yield { sensor: sensor.name, input: unit.state.path, value };
  }
}

export function toDiagnostic(unit: Unit, e: unknown): Diagnostic {
  if (e instanceof AppError) {
    return { input: unit.state.path, code: e.code, message: e.message };
  }
  if (e instanceof Error) {
    return { input: unit.state.path, code: "INTERNAL", message: e.message };
  }
  return { input: unit.state.path, code: "INTERNAL", message: String(e) };
}
