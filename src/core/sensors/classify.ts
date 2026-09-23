/**
 * Classify — compiles rules to noul questions and batches them into ONE systemOne call per state
 * (sequential in v0). Emits Measurement { rule, input, value }: no thresholds, no handle invocation
 * here — interpretation is the handle callback's job (design §4.5).
 *
 * Per-unit failures come back as RequestErrors in the stream, never thrown past the pipeline
 * (design §7).
 */

import {
  RequestError,
  type Classifier,
  type Measurement,
  type QuestionSpec,
  type Rule,
  type Unit,
} from "../types.ts";

/** Which rule and unit (block wire id or file id) a question id belongs to. */
export interface QuestionAttribution {
  readonly rule: string;
  readonly blockId: string | null;
}

/**
 * A compiled question batch: the classifier-facing questions plus the id -> attribution map.
 * Question ids are never sent to the model — this map is the only way answers are attributed.
 */
export interface QuestionBatch {
  readonly questions: Record<string, QuestionSpec>;
  readonly attribution: Map<string, QuestionAttribution>;
}

/** The id of the question for (rule, blockId); block ids stay out of the payload's questions. */
export function questionKey(ruleName: string, blockId: string): string {
  return `${ruleName} in ${blockId}`;
}

/** The per-unit task sentence (generic; per-rule task wording failed calibration, tmp probes). */
export const UNIT_TASK = "Classifier the syntax unit mapped to this id against the criteria.";

/**
 * Compile rules to noul questions, criteria-as-rule (docs: primitives/noul): instructions maps the
 * unit id to the task sentence ({id: task}), criteria is the rule's actual rule passed straight
 * through. The unit id is the model's routing target (measured: object form is equal to the keyed
 * form at mean delta 0.024, tmp probes); question ids (record keys) are never sent.
 */
export function compileRuleQuestions(rules: readonly Rule[], unitId: string): QuestionBatch {
  const questions: Record<string, QuestionSpec> = {};
  const attribution = new Map<string, QuestionAttribution>();
  // single-rule runs key questions by bare unit id: one rule means no ambiguity, and the
  // capture json groups by unit id without a composite key (question ids are never sent).
  const bareKeys = rules.length === 1;
  for (const rule of rules) {
    const key = bareKeys ? unitId : questionKey(rule.name, unitId);
    questions[key] = {
      type: "noul",
      instructions: { [unitId]: UNIT_TASK },
      criteria: rule.criteria,
    };
    attribution.set(key, { rule: rule.name, blockId: unitId });
  }
  return { questions, attribution };
}

/**
 * The wire id for a judged span of a file: the treesitter LOC interval, 1-based — "L19" for a
 * single line, "L19-L28" for a range. Spans of top-level elements are disjoint, so ids are unique
 * within a file and point straight at the source (measured: readings equal the content-hash id at
 * mean delta 0.027, tmp probes).
 */
export function elementWireId(span: {
  readonly start: { readonly line: number };
  readonly end: { readonly line: number };
}): string {
  return span.start.line === span.end.line
    ? `L${span.start.line}`
    : `L${span.start.line}-L${span.end.line}`;
}

/** Legacy content hash — only for diff states, which have no line identity. */
export function contentHash(content: string): string {
  return new Bun.CryptoHasher("sha256").update(content).digest("hex").slice(0, 8);
}

export async function* classifyUnit(
  unit: Unit,
  rules: readonly Rule[],
  classifier: Classifier,
): AsyncGenerator<Measurement | RequestError> {
  if (rules.length === 0) return;
  // Any acquisition resolves into target instances upstream, so every rule participates.
  const unitId =
    "id" in unit.state
      ? unit.state.id
      : elementWireId({ start: { line: 1 }, end: { line: unit.state.diff.split(`\n`).length } });
  const batch = compileRuleQuestions(rules, unitId);
  let answers: Record<string, number>;
  try {
    answers = await classifier(unit.state, batch.questions);
  } catch (thrown) {
    yield toRequestError(unit.state.path, thrown);
    return;
  }
  for (const rule of rules) {
    const key = [...batch.attribution.entries()].find(([, a]) => a.rule === rule.name)![0];
    const value = answers[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      yield invalidAnswerError(unit.state.path, rule.name);
      continue;
    }
    yield { rule: rule.name, input: unit.state.path, value };
  }
}

/** RequestError for an answer that is missing or not a finite number (JEV_RESPONSE_INVALID). */
export function invalidAnswerError(input: string, ruleName: string): RequestError {
  return new RequestError(
    "JEV_RESPONSE_INVALID",
    input,
    `answer for '${ruleName}' is missing or not a finite number`,
  );
}

/**
 * Map anything a classifier threw into a streamed RequestError; the seam's code survives (design
 * §7).
 */
export function toRequestError(input: string, thrown: unknown): RequestError {
  if (thrown instanceof RequestError) {
    // The seam throws with the state path; the funnel refines block-scoped inputs (path#block-N).
    return new RequestError(thrown.code, input, thrown.message, { cause: thrown });
  }
  if (thrown instanceof Error) return new RequestError("INTERNAL", input, thrown.message);
  return new RequestError("INTERNAL", input, String(thrown));
}
