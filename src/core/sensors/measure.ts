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

/** Which sensor and block a question id belongs to; blockId is null for whole-unit questions. */
export interface QuestionAttribution {
  readonly sensor: string;
  readonly blockId: string | null;
}

/**
 * A compiled question batch: the judge-facing questions plus the id -> attribution map. Question
 * ids are never sent to the model — this map is the only way answers are attributed.
 */
export interface QuestionBatch {
  readonly questions: Record<string, QuestionSpec>;
  readonly attribution: Map<string, QuestionAttribution>;
}

/** The id of the question for (sensor, blockId); block ids stay out of the payload's questions. */
export function questionKey(sensorName: string, blockId: string): string {
  return `${sensorName} in ${blockId}`;
}

/**
 * Compile sensors to noul questions in the documented shape (docs: primitives/noul): instructions
 * is the plain-string question, criteria describes the outcomes. Block-scoped questions append a
 * scoping sentence naming the block id; whole-unit questions judge the code as-is.
 */
export function compileSensorQuestions(
  sensors: readonly Sensor[],
  blockId: string | null = null,
): QuestionBatch {
  const questions: Record<string, QuestionSpec> = {};
  const attribution = new Map<string, QuestionAttribution>();
  for (const sensor of sensors) {
    const where = blockId === null ? "in the code" : "in that code block";
    const scope = blockId === null ? "" : ` Judge only the code block with id ${blockId}.`;
    const key = blockId === null ? sensor.name : questionKey(sensor.name, blockId);
    questions[key] = {
      type: "noul",
      instructions: `${sensor.description}${scope}`,
      criteria: {
        true: `the described property holds ${where}`,
        false: `the described property does not hold ${where}`,
      },
    };
    attribution.set(key, { sensor: sensor.name, blockId });
  }
  return { questions, attribution };
}

export async function* measureUnit(
  unit: Unit,
  sensors: readonly Sensor[],
  judge: Judge,
): AsyncGenerator<Measurement | Diagnostic> {
  if (sensors.length === 0) return;
  // Any acquisition resolves into target instances upstream, so every sensor participates.
  const { questions } = compileSensorQuestions(sensors);
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
