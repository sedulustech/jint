/**
 * Classify — compiles rules to noul questions and batches them into ONE systemOne call per state
 * (sequential in v0). Emits Measurement { rule, input, value }: no thresholds, no handle invocation
 * here — interpretation is the handle callback's job (design §4.5).
 *
 * Per-unit failures come back as MeasureErrors in the stream, never thrown past the pipeline
 * (design §7).
 */

import { decompose, languageOf, type InventoryElement } from "../input/decompose.ts";
import {
  MeasureError,
  type AnyState,
  type Classifier,
  type ElementState,
  type Measurement,
  type QuestionSpec,
  type Rule,
  type Span,
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
export const UNIT_TASK = "Judge the syntax unit mapped to this id against the criteria.";

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
): AsyncGenerator<Measurement | MeasureError> {
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
    yield toMeasureError(unit.state.path, thrown);
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

/** MeasureError for an answer that is missing or not a finite number (JEV_RESPONSE_INVALID). */
export function invalidAnswerError(input: string, ruleName: string): MeasureError {
  return new MeasureError(
    "JEV_RESPONSE_INVALID",
    input,
    `answer for '${ruleName}' is missing or not a finite number`,
  );
}

/**
 * Map anything a classifier threw into a streamed MeasureError; the seam's code survives (design
 * §7).
 */
export function toMeasureError(input: string, thrown: unknown): MeasureError {
  if (thrown instanceof MeasureError) {
    // The seam throws with the state path; the pipeline refines block-scoped inputs (path#L19-L28).
    return new MeasureError(thrown.code, input, thrown.message, { cause: thrown });
  }
  if (thrown instanceof Error) return new MeasureError("INTERNAL", input, thrown.message);
  return new MeasureError("INTERNAL", input, String(thrown));
}

// ---------------------------------------------------------------------------
// Element classification — derive the inventory, then classify every element
// x every inventory-scoped rule in chunked concurrent calls, ONE pass.

/** Which kind of thing a measurement measured: the unit itself, or an element of its inventory. */
export type ClassifyStage = "file" | "element";

/** One streamed event plus what produced it (and where, for element readings). */
export interface ClassifyEvent {
  readonly event: Measurement | MeasureError;
  readonly stage: ClassifyStage;
  /** The measured element's source span; element-scoped measurements only. */
  readonly span?: Span;
}

export interface ClassifyResult {
  readonly events: ClassifyEvent[];
  /** A JEV_AUTH error aborts the whole run. */
  readonly fatal: boolean;
}

/** Rules whose target matches an element's kind (design §7.1: the target routes). */
const rulesForElement = (rules: readonly Rule[], element: InventoryElement): Rule[] => {
  const commentElement = element.role === "comment";
  const carriesComment = commentElement || (element.attachedComment?.length ?? 0) > 0;
  return rules.filter((rule) =>
    rule.target === "comments"
      ? carriesComment
      : rule.target === "functions"
        ? !commentElement && element.role === "function"
        : rule.target === "definitions"
          ? !commentElement
          : false,
  );
};
/**
 * Classify one unit: the unit-scoped rules over the whole unit, then every element of the inventory
 * x every inventory-scoped rule, chunked <=50-question calls run concurrently. One pass, no
 * candidacy: every measurement is a reading the rule's handle judges.
 *
 * No fallback: a file that maps to no elements yields no element classification and its
 * inventory-scoped rules fail with a per-unit MAPPING_FAILED error. Unit-scoped rules (files/diffs)
 * judge the unit itself; their target never needed parsing.
 */
export async function classifyFile(
  unit: Unit,
  rules: readonly Rule[],
  classifier: Classifier,
  isAborted: () => boolean = () => false,
): Promise<ClassifyResult> {
  const state = unit.state;
  const content =
    "content" in state && typeof state.content === "string"
      ? state.content
      : String((state as unknown as Record<string, unknown>).diff ?? "");

  const events: ClassifyEvent[] = [];
  const fatalIn = () =>
    events.some((e) => e.event instanceof MeasureError && e.event.code === "JEV_AUTH");

  // Whole-unit rules: files-target rules are relational claims judged over the whole unit;
  // on a diff unit the diffs-target rules join, judging the raw diff string as one unit
  // (quick path: verbatim, no parsing, no per-unit ids - design §4 Diff units).
  const wholeRules = rules.filter(
    (rule) => rule.target === "files" || (rule.target === "diffs" && unit.kind === "diff"),
  );
  const fileId = "id" in state ? state.id : contentHash(state.diff);
  if (wholeRules.length > 0) {
    const whole = await call(
      state,
      compileRuleQuestions(wholeRules, fileId).questions,
      classifier,
      state.path,
    );
    collect(
      events,
      "file",
      whole,
      wholeRules.map((rule) => questionKey(rule.name, fileId)),
      state.path,
    );
    if (fatalIn()) return { events, fatal: true };
  }

  // Derive the inventory; failure is a per-unit error for the inventory-scoped rules.
  let inventory: InventoryElement[] = [];
  let failed: string | null = null;
  if (unit.kind !== "file") {
    failed = "non-file unit";
  } else {
    const language = languageOf(state.path);
    if (language === null) {
      failed = "no grammar mapping for extension";
    } else {
      try {
        const parsed = await decompose(content, language);
        inventory = [...parsed.definitions, ...parsed.comments];
        if (inventory.length === 0) failed = "no definitions or comments found";
      } catch {
        failed = "parse failed";
      }
    }
  }
  if (failed !== null && unit.kind === "file") {
    events.push({
      event: new MeasureError("MAPPING_FAILED", state.path, `cannot map to elements: ${failed}`),
      stage: "file",
    });
  }

  // Every element x its inventory-scoped rules, one question each, chunked fan-out:
  // a single response serializes answers past ~20-50 questions (~0.12s each), so the
  // questions split into <=50-question calls run concurrently (measured: 207 answers in
  // 26s unchunked vs 3.2s chunked; answers stable at mean |delta| 0.02 across shapes).
  const elements: ElementState[] = [];
  const questions: Record<string, QuestionSpec> = {};
  const attribution = new Map<string, QuestionAttribution>();
  const spanByWireId = new Map<string, Span>();
  for (const element of inventory) {
    const scoped = rulesForElement(rules, element);
    if (scoped.length === 0) continue;
    const wireId = elementWireId(element.span);
    elements.push({ id: wireId, content: elementContent(element) });
    spanByWireId.set(wireId, element.span);
    const batch = compileRuleQuestions(scoped, wireId);
    Object.assign(questions, batch.questions);
    for (const [key, attr] of batch.attribution) attribution.set(key, attr);
  }
  if (elements.length === 0 || isAborted()) return { events, fatal: false };

  const keys = Object.keys(questions);
  const CHUNK = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += CHUNK) chunks.push(keys.slice(i, i + CHUNK));
  const errors: MeasureError[] = [];
  const answers: Record<string, number> = {};
  await Promise.all(
    chunks.map(async (chunkKeys) => {
      const chunkQuestions = Object.fromEntries(chunkKeys.map((k) => [k, questions[k]!]));
      const result = await call(
        { path: state.path, elements },
        chunkQuestions,
        classifier,
        state.path,
      );
      if (result.error !== null) errors.push(result.error);
      Object.assign(answers, result.answers);
    }),
  );
  for (const error of errors) events.push({ event: error, stage: "element" });
  if (fatalIn()) return { events, fatal: true };
  for (const [key, value] of Object.entries(answers)) {
    // keys may be composite ("<rule> in <unitId>") or bare unit ids (single-rule runs);
    // the attribution map built at question-construction time is the source of truth
    const attr = attribution.get(key);
    const span = attr && attr.blockId !== null ? spanByWireId.get(attr.blockId) : undefined;
    if (attr === undefined || attr.blockId === null || span === undefined) {
      events.push({ event: invalidAnswerError(state.path, key), stage: "element" });
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      events.push({ event: invalidAnswerError(state.path, attr.rule), stage: "element" });
      continue;
    }
    events.push({
      event: { rule: attr.rule, input: `${state.path}#${attr.blockId}`, value },
      stage: "element",
      span,
    });
  }
  return { events, fatal: false };
}
/**
 * A definition's attached docblock is consumed into the element (design §7.2) — it reads as
 * written.
 */
function elementContent(element: InventoryElement): string {
  return [...(element.attachedComment ?? []), element.content].join("\n");
}

interface CallResult {
  readonly answers: Record<string, number>;
  readonly error: MeasureError | null;
}

async function call(
  state: AnyState,
  questions: Record<string, QuestionSpec>,
  classifier: Classifier,
  input: string,
): Promise<CallResult> {
  try {
    return { answers: await classifier(state, questions), error: null };
  } catch (thrown) {
    return { answers: {}, error: toMeasureError(input, thrown) };
  }
}

/** Distribute one call's answers as measurements keyed by the given question names. */
function collect(
  events: ClassifyEvent[],
  stage: ClassifyStage,
  result: CallResult,
  questionNames: readonly string[],
  input: string,
): void {
  if (result.error !== null) {
    events.push({ event: result.error, stage });
    return;
  }
  for (const key of questionNames) {
    const value = result.answers[key];
    // question keys are "<rule> in <unitId>"; the rule is the part before the unit id
    const rule = key.slice(0, key.indexOf(" in "));
    if (typeof value !== "number" || !Number.isFinite(value)) {
      events.push({ event: invalidAnswerError(input, rule), stage });
      continue;
    }
    events.push({ event: { rule, input, value }, stage });
  }
}
