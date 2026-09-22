/**
 * Measure — compiles sensors to noul questions and batches them into ONE systemOne call per state
 * (sequential in v0). Emits Measurement { sensor, input, value }: no thresholds, no handle
 * invocation here — interpretation is the handle callback's job (design §4.5).
 *
 * Per-unit failures come back as Diagnostics in the stream, never thrown past the pipeline (design
 * §7).
 */

import {
  AppError,
  type Diagnostic,
  type Judge,
  type Measurement,
  type QuestionSpec,
  type Sensor,
  type Unit,
} from "../types.ts";

/** Compile sensors to noul questions using the validated structured measurement envelope. */
export function compileSensorQuestions(sensors: readonly Sensor[]): Record<string, QuestionSpec> {
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
  if (sensors.length === 0) return;
  // Any acquisition resolves into target instances upstream, so every sensor participates.
  const questions = compileSensorQuestions(sensors);
  let answers: Record<string, number>;
  try {
    answers = await judge(unit.state, questions);
  } catch (thrown) {
    yield toDiagnostic(unit, thrown);
    return;
  }
  for (const sensor of sensors) {
    const value = answers[sensor.name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      yield toInvalidAnswerDiagnostic(unit, sensor.name);
      continue;
    }
    yield { sensor: sensor.name, input: unit.state.path, value };
  }
}

/** Diagnostic for an answer that is missing or not a finite number (JEV_RESPONSE_INVALID). */
function toInvalidAnswerDiagnostic(unit: Unit, sensorName: string): Diagnostic {
  return {
    input: unit.state.path,
    code: "JEV_RESPONSE_INVALID",
    message: `answer for '${sensorName}' is missing or not a finite number`,
  };
}

export function toDiagnostic(unit: Unit, thrown: unknown): Diagnostic {
  if (thrown instanceof AppError) {
    return { input: unit.state.path, code: thrown.code, message: thrown.message };
  }
  if (thrown instanceof Error) {
    return { input: unit.state.path, code: "INTERNAL", message: thrown.message };
  }
  return { input: unit.state.path, code: "INTERNAL", message: String(thrown) };
}
