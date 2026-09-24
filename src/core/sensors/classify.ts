/**
 * Classify — compiles rules to noul questions and batches them into ONE systemOne call per state
 * (sequential in v0). Emits Measurement { rule, input, value }: no thresholds, no handle invocation
 * here — interpretation is the handle callback's job (design §4.5).
 *
 * Per-unit failures come back as MeasureErrors in the stream, never thrown past the pipeline
 * (design §7).
 */

import {
  decompose,
  languageOf,
  type Inventory,
  type InventoryElement,
} from "../input/decompose.ts";
import {
  MeasureError,
  type AnyState,
  type Classifier,
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

/**
 * The per-unit task sentence (generic; per-rule task wording failed calibration, tmp probes). No
 * "mapped to this id" routing anymore: each call hands the model exactly one unit as the state, so
 * there is no id mapping to route by. Recalibration event: thresholds anchored to the previous
 * sentence need re-derivation.
 */
export const UNIT_TASK = "Judge the syntax unit against the criteria.";

/**
 * Compile rules to questions for ONE unit state, criteria-as-rule: instructions is the generic task
 * sentence, criteria is the rule's actual rule passed straight through. Question ids (record keys)
 * are never sent — the attribution map correlates answers.
 */
export function compileRuleQuestions(rules: readonly Rule[], unitId: string): QuestionBatch {
  const questions: Record<string, QuestionSpec> = {};
  const attribution = new Map<string, QuestionAttribution>();
  for (const rule of rules) {
    // choice: ordered rubric -> ScoreQuestion (score is the right primitive; ChoiceQuestion is
    // for named unordered options and stays unused)
    questions[questionKey(rule.name, unitId)] =
      rule.kind === "choice"
        ? { type: "score", instructions: rule.instructions, criteria: rule.criteria }
        : { type: "noul", instructions: UNIT_TASK, criteria: rule.criteria };
    attribution.set(questionKey(rule.name, unitId), { rule: rule.name, blockId: unitId });
  }
  return { questions, attribution };
}

/**
 * Compile an element's rules to questions keyed by bare rule name: one element per call means no
 * ambiguity (mirror of the single-rule bare-key behavior of compileRuleQuestions).
 */
export function compileElementQuestions(rules: readonly Rule[]): Record<string, QuestionSpec> {
  const questions: Record<string, QuestionSpec> = {};
  for (const rule of rules) {
    questions[rule.name] =
      rule.kind === "choice"
        ? { type: "score", instructions: rule.instructions, criteria: rule.criteria }
        : { type: "noul", instructions: UNIT_TASK, criteria: rule.criteria };
  }
  return questions;
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
// x every inventory-scoped rule, one concurrent call per element (bounded), ONE pass.

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
  /** The derived inventory, when the source parsed into elements; absent on derivation failure. */
  readonly inventory?: Inventory;
}

/**
 * In-flight one-element classifier calls per file. Provisional: waves mirror FILE_CONCURRENCY
 * semantics; unanchored until element-call latency is measured on the self-corpus.
 */
export const ELEMENT_CONCURRENCY = 8;

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
 * x every inventory-scoped rule, one call per element under a bounded-concurrency scheduler. One
 * pass, no candidacy: every measurement is a reading the rule's handle judges.
 *
 * No fallback: a file that maps to no elements yields no element classification and its
 * inventory-scoped rules fail with a per-unit WALK_FAILED error. Unit-scoped rules (files/diffs)
 * judge the unit itself; their target never needed parsing.
 */
export interface ClassifyFileOptions {
  /** Explicit grammar override; when absent the language comes from the state path's extension. */
  readonly language?: string;
  /** Cap on in-flight one-element classifier calls (default ELEMENT_CONCURRENCY). */
  readonly concurrency?: number;
}

export async function classifyFile(
  unit: Unit,
  rules: readonly Rule[],
  classifier: Classifier,
  isAborted: () => boolean = () => false,
  options: ClassifyFileOptions = {},
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
  let derived: Inventory | undefined;
  let failed: string | null = null;
  if (unit.kind !== "file") {
    failed = "non-file unit";
  } else {
    const language = options.language ?? languageOf(state.path);
    if (language === null) {
      failed = "no grammar mapping for extension";
    } else {
      try {
        const parsed = await decompose(content, language);
        inventory = [...parsed.definitions, ...parsed.comments];
        if (inventory.length === 0) {
          failed = "no definitions or comments found";
        } else {
          derived = parsed;
        }
      } catch {
        failed = "parse failed";
      }
    }
  }
  if (failed !== null && unit.kind === "file") {
    events.push({
      event: new MeasureError("WALK_FAILED", state.path, `cannot map to elements: ${failed}`),
      stage: "file",
    });
  }

  // ------------------------------------------------------------------
  // REGRESSION BAN — the array state {path, elements: [{id, content}]} with many questions is
  // BANNED: one state x many questions is valid, but the state x question MATRIX form makes jev
  // answer every question from the file's average, not the element. Measured (tmp/readability-iso,
  // tmp/noul-shape-probe): noul pinned 0.61-0.66 across 21 elements whose per-element source-state
  // readings spread 0.60-0.92; score readings flat 0.32-0.35 vs a discriminating spread isolated.
  // Hence: ONE element per call (state = {path, source}), all of that element's rules' questions
  // batched inside the call (multiple questions x one state is fine), elements fanned out by
  // CONCURRENCY, not questions-per-call.
  const jobs: Array<{ wireId: string; span: Span; source: string; rules: Rule[] }> = [];
  for (const element of inventory) {
    const scoped = rulesForElement(rules, element);
    if (scoped.length === 0) continue;
    const wireId = elementWireId(element.span);
    jobs.push({ wireId, span: element.span, source: elementContent(element), rules: scoped });
  }
  if (jobs.length === 0 || isAborted()) return { events, fatal: false };

  let next = 0;
  let aborted = false;
  const worker = async (): Promise<void> => {
    while (next < jobs.length && !aborted && !isAborted()) {
      const job = jobs[next++]!;
      const input = `${state.path}#${job.wireId}`;
      const result = await call(
        { path: state.path, source: job.source },
        compileElementQuestions(job.rules),
        classifier,
        input,
      );
      if (result.error !== null) {
        events.push({ event: result.error, stage: "element" });
        if (result.error.code === "JEV_AUTH") aborted = true;
        continue;
      }
      for (const [rule, value] of Object.entries(result.answers)) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          events.push({ event: invalidAnswerError(input, rule), stage: "element" });
          continue;
        }
        events.push({ event: { rule, input, value }, stage: "element", span: job.span });
      }
    }
  };
  // Elements fan out as concurrent one-element calls (chunking questions per call is what produced
  // the averaged matrix readings); the cap bounds in-flight requests per file.
  const concurrency = options.concurrency ?? ELEMENT_CONCURRENCY;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  if (aborted) return { events, fatal: true, inventory: derived };
  return { events, fatal: false, inventory: derived };
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
