/**
 * Classify — compiles rules to noul questions and batches them into ONE systemOne call per state
 * (sequential in v0). Emits Measurement { rule, input, value }: no thresholds, no handle invocation
 * here — interpretation is the handle callback's job (design §4.5).
 *
 * Per-unit failures come back as ClassifyErrors in the stream, never thrown past the pipeline
 * (design §7).
 */

import { decompose, languageOf, type Inventory, type InventoryElement } from "../input/walk.ts";
import {
  ClassifyError,
  type AnyState,
  type Classifier,
  type Measurement,
  type QuestionSpec,
  type Rule,
  type Span,
  type Unit,
  type UnitKind,
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
 * The fallback task sentence for noul rules that ship no instructions of their own (config rules
 * predating the field). Default rules each carry a specific yes/no question; UNIT_TASK is only what
 * a question-less rule falls back to. Recalibration event: readings taken under this sentence
 * differ from readings under per-rule questions.
 */
export const UNIT_TASK = "Judge the syntax unit against the criteria.";

/** The question instructions for one rule: its own question, or the generic task sentence. */
function instructionsOf(rule: Rule): string {
  return rule.instructions ?? UNIT_TASK;
}

/**
 * The kind sentence prepended to every question's instructions: what kind of object the state is,
 * stated explicitly so the model never infers it. One noun per unit kind and per element role.
 */
export function kindSentence(kind: string): string {
  return `This unit is a ${kind}.`;
}

/** The noun for a whole-unit state: a source file, or a raw diff block. */
export function unitKindNoun(kind: UnitKind): string {
  return kind === "diff" ? "diff block" : "source file";
}

/** The noun for an inventory element: its abstracted role, stated as a definition where apt. */
export function elementKindNoun(role: string): string {
  if (role === "function") return "function definition";
  if (role === "type") return "type definition";
  // binding | import | comment
  return role;
}

/**
 * Compile rules to questions for ONE unit state, criteria-as-rule: instructions is the rule's own
 * question (UNIT_TASK only as the fallback), criteria is the rule's actual rule passed straight
 * through. Question ids (record keys) are never sent — the attribution map correlates answers.
 */
export function compileRuleQuestions(
  rules: readonly Rule[],
  unitId: string,
  unitKind: UnitKind = "file",
): QuestionBatch {
  const questions: Record<string, QuestionSpec> = {};
  const attribution = new Map<string, QuestionAttribution>();
  for (const rule of rules) {
    // kind-stating instructions, always: the rule's own question (or the UNIT_TASK fallback)
    // prefixed with what the state is — a choice rule's scoring instructions get the same prefix
    const instructions = `${kindSentence(unitKindNoun(unitKind))} ${instructionsOf(rule)}`;
    // choice: ordered rubric -> ScoreQuestion (score is the right primitive; ChoiceQuestion is
    // for named unordered options and stays unused)
    questions[questionKey(rule.name, unitId)] =
      rule.kind === "choice"
        ? { type: "score", instructions, criteria: rule.criteria }
        : { type: "noul", instructions, criteria: rule.criteria };
    attribution.set(questionKey(rule.name, unitId), { rule: rule.name, blockId: unitId });
  }
  return { questions, attribution };
}

/**
 * Compile an element's rules to questions keyed by bare rule name: one element per call means no
 * ambiguity (mirror of the single-rule bare-key behavior of compileRuleQuestions).
 */
export function compileElementQuestions(
  rules: readonly Rule[],
  role: string,
): Record<string, QuestionSpec> {
  const questions: Record<string, QuestionSpec> = {};
  const instructions = `${kindSentence(elementKindNoun(role))} `;
  for (const rule of rules) {
    const text = instructions + instructionsOf(rule);
    questions[rule.name] =
      rule.kind === "choice"
        ? { type: "score", instructions: text, criteria: rule.criteria }
        : { type: "noul", instructions: text, criteria: rule.criteria };
  }
  return questions;
}

/**
 * The wire id for a judged span of a file: the treesitter LOC interval, 1-based — "L19" for a
 * single line, "L19-L28" for a range. Spans of top-level elements are disjoint, so ids are unique
 * within a file and point straight at the source (classified: readings equal the content-hash id at
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
): AsyncGenerator<Measurement | ClassifyError> {
  if (rules.length === 0) return;
  // Any acquisition resolves into target instances upstream, so every rule participates.
  const unitId =
    "id" in unit.state
      ? unit.state.id
      : elementWireId({ start: { line: 1 }, end: { line: unit.state.diff.split(`\n`).length } });
  const batch = compileRuleQuestions(rules, unitId, unit.kind);
  let answers: Record<string, number>;
  try {
    answers = await classifier(unit.state, batch.questions);
  } catch (thrown) {
    yield toClassifyError(unit.state.path, thrown);
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

/** ClassifyError for an answer that is missing or not a finite number (JEV_RESPONSE_INVALID). */
export function invalidAnswerError(input: string, ruleName: string): ClassifyError {
  return new ClassifyError(
    "JEV_RESPONSE_INVALID",
    input,
    `answer for '${ruleName}' is missing or not a finite number`,
  );
}

/**
 * Map anything a classifier threw into a streamed ClassifyError; the seam's code survives (design
 * §7).
 */
export function toClassifyError(input: string, thrown: unknown): ClassifyError {
  if (thrown instanceof ClassifyError) {
    // The seam throws with the state path; the pipeline refines block-scoped inputs (path#L19-L28).
    return new ClassifyError(thrown.code, input, thrown.message, { cause: thrown });
  }
  if (thrown instanceof Error)
    return new ClassifyError("INTERNAL", input, thrown.message, { cause: thrown });
  return new ClassifyError("INTERNAL", input, String(thrown));
}

// ---------------------------------------------------------------------------
// Element classification — derive the inventory, then classify every element
// x every inventory-scoped rule, one concurrent call per element (bounded), ONE pass.

/** Which kind of thing a measurement classified: the unit itself, or an element of its inventory. */
export type ClassifyStage = "file" | "element";

/** One streamed event plus what produced it (and where, for element readings). */
export interface ClassifyEvent {
  readonly event: Measurement | ClassifyError;
  readonly stage: ClassifyStage;
  /** The classified element's source span; element-scoped measurements only. */
  readonly span?: Span;
}

export interface ClassifyResult {
  readonly events: ClassifyEvent[];
  /** A JEV_AUTH error aborts the whole run. */
  readonly fatal: boolean;
  /** The derived inventory, when the source parsed into elements; absent on derivation failure. */
  readonly inventory?: Inventory;
  /** Elements skipped as oversized (over MAX_ELEMENT_CHARS): never judged, reported in-band. */
  readonly oversized: number;
}

/**
 * In-flight one-element classifier calls per file. Provisional: waves mirror FILE_CONCURRENCY
 * semantics; unanchored until element-call latency is classified on the self-corpus.
 */
export const ELEMENT_CONCURRENCY = 8;

/**
 * The minimal element shape the target grammar reads; both tiers' element views satisfy it (the TS
 * view carries attachedComment through precisely so this one predicate serves both).
 */
export interface TargetableElement {
  readonly role: string;
  readonly oversized?: boolean;
  readonly attachedComment?: readonly string[];
}

/**
 * THE target grammar (design §7.1: the target routes) — one implementation for BOTH tiers. The JSON
 * element funnel (rulesForElement) and the TS resolver (resolveTargets) both consume this; a
 * target's element mapping can never drift between tiers. Oversized elements are never judged
 * (design: composite body-size fix) — the size backstop trades their readings for the run's
 * reliability; the count surfaces in-band, never silent.
 */
export function matchesTarget(target: string, element: TargetableElement): boolean {
  if (element.oversized === true) return false;
  const commentElement = element.role === "comment";
  const importElement = element.role === "import";
  const carriesComment = commentElement || (element.attachedComment?.length ?? 0) > 0;
  return target === "comments"
    ? carriesComment
    : target === "functions"
      ? !commentElement && element.role === "function"
      : target === "definitions"
        ? !commentElement && !importElement
        : target === "imports"
          ? importElement
          : false;
}

/**
 * The JSON element funnel (design §7.1). Exported for the cross-tier consistency test: the TS tier
 * must select the same elements per target as this funnel, by construction (shared predicate).
 */
export const rulesForElement = (rules: readonly Rule[], element: InventoryElement): Rule[] =>
  rules.filter((rule) => matchesTarget(rule.target, element));
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

/**
 * The walk phase, extracted (design rules-context/03 walk-first): read + parse + extract the
 * inventory (metadata + parent links), free the tree. lint runs this ONCE over all file units
 * before any classification, then hands the result back to classifyFile so nothing re-walks.
 */
export interface WalkedUnit {
  readonly inventory: InventoryElement[];
  readonly derived?: Inventory;
  /** Why the unit could not be mapped to elements (file units only); streamed as WALK_FAILED. */
  readonly failed: string | null;
  readonly failedCause: unknown;
}

export async function walkUnit(unit: Unit, options: ClassifyFileOptions = {}): Promise<WalkedUnit> {
  const state = unit.state;
  const content =
    "content" in state && typeof state.content === "string"
      ? state.content
      : String((state as unknown as Record<string, unknown>).diff ?? "");
  let inventory: InventoryElement[] = [];
  let derived: Inventory | undefined;
  let failed: string | null = null;
  let failedCause: unknown;
  if (unit.kind !== "file") {
    failed = "non-file unit";
  } else {
    const language = options.language ?? languageOf(state.path);
    if (language === null) {
      // An extension names the remedy (fix the mapping); an extensionless path is piped stdin
      // (the str noun) — there is no extension to map, the remedy is declaring the grammar.
      failed = /\.[^./]+$/.test(state.path)
        ? "no grammar mapping for extension"
        : "cannot infer a grammar for piped stdin - declare it with --language";
    } else {
      try {
        const parsed = await decompose(content, language);
        inventory = [...parsed.definitions, ...parsed.comments, ...parsed.imports];
        if (inventory.length === 0) {
          failed = "no definitions, comments, or imports found";
        } else {
          derived = parsed;
        }
      } catch (thrown) {
        failed = "parse failed";
        failedCause = thrown;
      }
    }
  }
  return { inventory, derived, failed, failedCause };
}

export async function classifyFile(
  unit: Unit,
  rules: readonly Rule[],
  classifier: Classifier,
  isAborted: () => boolean = () => false,
  options: ClassifyFileOptions = {},
  walked?: WalkedUnit,
): Promise<ClassifyResult> {
  const state = unit.state;
  const events: ClassifyEvent[] = [];
  const fatalIn = () =>
    events.some((e) => e.event instanceof ClassifyError && e.event.code === "JEV_AUTH");

  // Whole-unit rules: files-target rules are relational claims judged over the whole unit;
  // on a diff unit the diffs-target rules join, judging the raw diff string as one unit
  // (quick path: verbatim, no parsing, no per-unit ids - design §4 Diff units). A str unit is
  // its own inventory: the whole input is the element, so EVERY rule judges it whole — the
  // rule's target routes elements of a parsed inventory, and a str unit has no inventory by
  // design. No grammar is ever inferred for it.
  const wholeRules = rules.filter((rule) =>
    unit.kind === "str"
      ? true
      : rule.target === "files" || (rule.target === "diffs" && unit.kind === "diff"),
  );
  const fileId = "id" in state ? state.id : contentHash(state.diff);
  if (wholeRules.length > 0) {
    const whole = await call(
      state,
      compileRuleQuestions(wholeRules, fileId, unit.kind).questions,
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
    if (fatalIn()) return { events, fatal: true, oversized: 0 };
  }

  // Derive the inventory; failure is a per-unit error for the inventory-scoped rules. Only file
  // units have one: str and diff units are already terminal states (no grammar, no mapping, so
  // no WALK_FAILED either — `failed` stays unpushed for them by the kind check below).
  // Walk-first (design rules-context/03): the walk phase already ran over every file unit; a
  // passed-in walked unit is reused verbatim. Without one (the classify() one-shot door), walk now.
  let inventory: InventoryElement[] = [];
  let derived: Inventory | undefined;
  let failed: string | null = null;
  let failedCause: unknown;
  {
    const w = walked ?? (await walkUnit(unit, options));
    inventory = w.inventory;
    derived = w.derived;
    failed = w.failed;
    failedCause = w.failedCause;
  }
  if (failed !== null && unit.kind === "file") {
    events.push({
      event: new ClassifyError(
        "WALK_FAILED",
        state.path,
        `cannot map to elements: ${failed}`,
        // Chain the underlying failure (parse error detail) without changing the message the
        // renderers print — output stays bounded, the cause rides the Error for debugging.
        failedCause !== undefined ? { cause: failedCause } : undefined,
      ),
      stage: "file",
    });
  }

  // ------------------------------------------------------------------
  // REGRESSION BAN — the array state {path, elements: [{id, content}]} with many questions is
  // BANNED: one state x many questions is valid, but the state x question MATRIX form makes jev
  // answer every question from the file's average, not the element. Classifyd (tmp/readability-iso,
  // tmp/noul-shape-probe): noul pinned 0.61-0.66 across 21 elements whose per-element source-state
  // readings spread 0.60-0.92; score readings flat 0.32-0.35 vs a discriminating spread isolated.
  // Hence: ONE element per call (state = {path, source}), all of that element's rules' questions
  // batched inside the call (multiple questions x one state is fine), elements fanned out by
  // CONCURRENCY, not questions-per-call.
  const jobs: Array<{
    wireId: string;
    span: Span;
    source: string;
    rules: Rule[];
    role: string;
  }> = [];
  for (const element of inventory) {
    const scoped = rulesForElement(rules, element);
    if (scoped.length === 0) continue;
    const wireId = elementWireId(element.span);
    jobs.push({
      wireId,
      span: element.span,
      source: elementContent(element),
      rules: scoped,
      role: element.role,
    });
  }
  const oversized = derived?.oversizedCount ?? 0;
  if (jobs.length === 0 || isAborted()) return { events, fatal: false, oversized };

  let next = 0;
  let aborted = false;
  const worker = async (): Promise<void> => {
    while (next < jobs.length && !aborted && !isAborted()) {
      const job = jobs[next++]!;
      const input = `${state.path}#${job.wireId}`;
      const result = await call(
        { path: state.path, source: job.source },
        compileElementQuestions(job.rules, job.role),
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
  if (aborted) return { events, fatal: true, inventory: derived, oversized };
  return { events, fatal: false, inventory: derived, oversized };
}
/**
 * A definition's attached docblock is consumed into the element (design §7.2) — it reads as
 * written.
 */
function elementContent(element: InventoryElement): string {
  // A docstring reads as written only with its owner: out of context a docstring always reads
  // like narration, so the payload names the module/class/function it documents.
  const owner = element.docstringOf
    ? [
        `docstring of ${element.docstringOf.kind}${element.docstringOf.name ? ` ${element.docstringOf.name}` : ""}:`,
      ]
    : [];
  return [...owner, ...(element.attachedComment ?? []), element.content].join("\n");
}

interface CallResult {
  readonly answers: Record<string, number>;
  readonly error: ClassifyError | null;
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
    return { answers: {}, error: toClassifyError(input, thrown) };
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
