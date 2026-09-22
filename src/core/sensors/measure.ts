/**
 * Measure — compiles sensors to noul questions and batches them into ONE systemOne call per state
 * (sequential in v0). Emits Measurement { sensor, input, value }: no thresholds, no handle
 * invocation here — interpretation is the handle callback's job (design §4.5).
 *
 * Per-unit failures come back as RequestErrors in the stream, never thrown past the pipeline
 * (design §7).
 */

import {
  RequestError,
  type Judge,
  type Measurement,
  type QuestionSpec,
  type Sensor,
  type Unit,
} from "../types.ts";

/** Which sensor and unit (block wire id or file id) a question id belongs to. */
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
 * Compile sensors to noul questions, criteria-as-rule (docs: primitives/noul): instructions is a
 * one-element array naming the unit to judge — the content-addressed unit id (a sweep block's wire
 * id, or the file's content hash); criteria is the sensor's actual rule, passed straight through.
 * The unit id goes to the model as the target; question ids (record keys) are never sent.
 */
export function compileSensorQuestions(sensors: readonly Sensor[], unitId: string): QuestionBatch {
  const questions: Record<string, QuestionSpec> = {};
  const attribution = new Map<string, QuestionAttribution>();
  for (const sensor of sensors) {
    const key = questionKey(sensor.name, unitId);
    questions[key] = {
      type: "noul",
      instructions: [unitId],
      criteria: sensor.criteria,
    };
    attribution.set(key, { sensor: sensor.name, blockId: unitId });
  }
  return { questions, attribution };
}

/**
 * The content-addressed wire id for any judged content: first 8 hex chars of sha256. Used for sweep
 * block ids and FileState ids alike. Re-exported from funnel.ts, the sweep's owner.
 */
export function blockWireId(content: string): string {
  return new Bun.CryptoHasher("sha256").update(content).digest("hex").slice(0, 8);
}

export async function* measureUnit(
  unit: Unit,
  sensors: readonly Sensor[],
  judge: Judge,
): AsyncGenerator<Measurement | RequestError> {
  if (sensors.length === 0) return;
  // Any acquisition resolves into target instances upstream, so every sensor participates.
  const unitId = "id" in unit.state ? unit.state.id : blockWireId(unit.state.diff);
  const { questions } = compileSensorQuestions(sensors, unitId);
  let answers: Record<string, number>;
  try {
    answers = await judge(unit.state, questions);
  } catch (thrown) {
    yield toRequestError(unit.state.path, thrown);
    return;
  }
  for (const sensor of sensors) {
    const value = answers[questionKey(sensor.name, unitId)];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      yield invalidAnswerError(unit.state.path, sensor.name);
      continue;
    }
    yield { sensor: sensor.name, input: unit.state.path, value };
  }
}

/** RequestError for an answer that is missing or not a finite number (JEV_RESPONSE_INVALID). */
export function invalidAnswerError(input: string, sensorName: string): RequestError {
  return new RequestError(
    "JEV_RESPONSE_INVALID",
    input,
    `answer for '${sensorName}' is missing or not a finite number`,
  );
}

/** Map anything a judge threw into a streamed RequestError; the seam's code survives (design §7). */
export function toRequestError(input: string, thrown: unknown): RequestError {
  if (thrown instanceof RequestError) {
    // The seam throws with the state path; the funnel refines block-scoped inputs (path#block-N).
    return new RequestError(thrown.code, input, thrown.message, { cause: thrown });
  }
  if (thrown instanceof Error) return new RequestError("INTERNAL", input, thrown.message);
  return new RequestError("INTERNAL", input, String(thrown));
}
