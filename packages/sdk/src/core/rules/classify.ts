/**
 * The seam between rules and the judge: rules compile to questions, questions batch into one
 * classifier call per state, answers stream back as readings, failures stream on the same channel
 * as typed errors. Deciding severity is the handle callback's job, never this seam's.
 */

import {
  decompose,
  fileElement,
  languageOf,
  projectElement,
  type Inventory,
  type WalkElement,
} from "../input/walk.ts";
import { judgesWholeUnit, ruleInScope } from "../scope.ts";
import {
  ClassifyError,
  type AnyState,
  type ClassifiedAnswer,
  type Element,
  type Classifier,
  type Measurement,
  type QuestionSchema,
  type Rule,
  type Span,
  type Unit,
  type UnitKind,
} from "../types.ts";

/** Which rule and block (block wire id or unit id) a question id belongs to. */
export interface QuestionAttribution {
  readonly rule: string;
  readonly blockId: string | null;
}

/**
 * A compiled question batch: the classifier-facing questions plus the questionId -> attribution
 * map. Question ids never reach the model — this map is the only attribution channel.
 */
export interface QuestionBatch {
  readonly questions: Record<string, QuestionSchema>;
  readonly attribution: Map<string, QuestionAttribution>;
}

export function questionKey(ruleName: string, blockId: string): string {
  return `${ruleName} in ${blockId}`;
}

/**
 * States what kind of object the judged state is. Prepended to every question's instructions so the
 * model never has to infer it from the payload.
 */
export function kindSentence(noun: string): string {
  return `This unit is a ${noun}.`;
}

/**
 * The noun for a whole-unit state. Every kind that reaches this seam (file, piped string) is judged
 * as source text, so one noun serves all; the kind parameter stays on the signature so call sites
 * declare which kind they are judging.
 */
export function unitKindNoun(_kind: UnitKind): string {
  return "source file";
}

export function elementKindNoun(role: string): string {
  if (role === "function") return "function definition";
  if (role === "type") return "type definition";
  return role;
}

function questionSpec(rule: Rule, instructions: string): QuestionSchema {
  return rule.kind === "choice"
    ? { type: "score", instructions, criteria: rule.criteria }
    : { type: "noul", instructions, criteria: rule.criteria };
}

/**
 * Compile rules to questions for ONE unit state, criteria-as-rule: the rule's criteria pass
 * straight through; only the instructions gain the kind-sentence prefix. Question ids (record keys)
 * are never sent — the attribution map correlates answers.
 */
export function compileRuleQuestions(
  rules: readonly Rule[],
  unitId: string,
  unitKind: UnitKind = "file",
): QuestionBatch {
  const questions: Record<string, QuestionSchema> = {};
  const attribution = new Map<string, QuestionAttribution>();
  for (const rule of rules) {
    const questionId = questionKey(rule.name, unitId);
    questions[questionId] = questionSpec(
      rule,
      `${kindSentence(unitKindNoun(unitKind))} ${rule.instructions}`,
    );
    attribution.set(questionId, { rule: rule.name, blockId: unitId });
  }
  return { questions, attribution };
}

/**
 * Compile an element's rules to questions. One element per call means bare rule names key the
 * answers with no id-space collisions.
 */
export function compileElementQuestions(
  rules: readonly Rule[],
  role: string,
): Record<string, QuestionSchema> {
  const kindPrefix = `${kindSentence(elementKindNoun(role))} `;
  const questions: Record<string, QuestionSchema> = {};
  for (const rule of rules) {
    questions[rule.name] = questionSpec(rule, kindPrefix + rule.instructions);
  }
  return questions;
}

/**
 * The wire id for a judged span of a file: the LOC interval, 1-based — "L19" for a single line,
 * "L19-L28" for a range. Top-level spans are disjoint, so ids are unique within a file and point
 * straight at the source. Unit ids only — element identity is a classify-time uuidv4, never a
 * positional span.
 */
export function elementWireId(span: {
  readonly start: { readonly line: number };
  readonly end: { readonly line: number };
}): string {
  return span.start.line === span.end.line
    ? `L${span.start.line}`
    : `L${span.start.line}-L${span.end.line}`;
}

export function invalidAnswerError(
  input: string,
  ruleName: string,
  unusableAnswer?: ClassifiedAnswer,
): ClassifyError {
  return new ClassifyError(
    "JEV_RESPONSE_INVALID",
    input,
    `answer for '${ruleName}' is missing or not a finite number`,
    unusableAnswer === undefined ? undefined : { cause: unusableAnswer },
  );
}

function isUsableAnswer(answer: ClassifiedAnswer | undefined): boolean {
  return answer !== undefined && typeof answer.value === "number" && Number.isFinite(answer.value);
}

function measurementFields(rule: string, input: string, answer: ClassifiedAnswer): Measurement {
  return {
    rule,
    input,
    value: answer.value,
    ...(answer.probabilities !== undefined && { probabilities: answer.probabilities }),
    ...(answer.confidence !== undefined && { confidence: answer.confidence }),
  };
}

export async function* classifyUnit(
  unit: Unit,
  rules: readonly Rule[],
  classifier: Classifier,
): AsyncGenerator<Measurement | ClassifyError> {
  if (rules.length === 0) return;
  // Any acquisition resolves into target instances upstream, so every rule participates.
  const unitId = unit.state.id;
  const questionBatch = compileRuleQuestions(rules, unitId, unit.kind);
  let answers: Record<string, ClassifiedAnswer>;
  try {
    answers = await classifier(unit.state, questionBatch.questions);
  } catch (thrown) {
    yield toClassifyError(unit.state.path, thrown);
    return;
  }
  for (const rule of rules) {
    const answer = answers[questionKey(rule.name, unitId)];
    if (!isUsableAnswer(answer)) {
      yield invalidAnswerError(unit.state.path, rule.name, answer);
      continue;
    }
    yield measurementFields(rule.name, unit.state.path, answer!);
  }
}

/**
 * Map anything a classifier threw into a streamed typed error; the seam's code survives. The
 * original rides along as cause: renderers print only the message, but debugging keeps the full
 * thrown value.
 */
export function toClassifyError(input: string, thrown: unknown): ClassifyError {
  if (thrown instanceof ClassifyError) {
    // The seam throws with the state path; the pipeline refines block-scoped inputs.
    return new ClassifyError(thrown.code, input, thrown.message, { cause: thrown });
  }
  if (thrown instanceof Error)
    return new ClassifyError("INTERNAL", input, thrown.message, { cause: thrown });
  // Non-Error throwables carry their detail only as cause; the message is the full string.
  return new ClassifyError("INTERNAL", input, String(thrown), { cause: thrown });
}

// ---------------------------------------------------------------------------

export interface ClassifyEvent {
  readonly event: Measurement | ClassifyError;
  /** The measured subject; whole-unit readings measure the file itself. */
  readonly element?: Element;
}

/** A skipped oversized element, named for the report: identity and size, never the content. */
export interface OversizedElement {
  /** The stable positional walk label ("d5"). */
  readonly label: string;
  readonly role: string;
  readonly span: Span;
  /** Source size in UTF-16 code units (content.length), as the note reports it. */
  readonly chars: number;
}

export interface ClassifyResult {
  readonly events: ClassifyEvent[];
  /** A JEV_AUTH error aborts the whole run. */
  readonly fatal: boolean;
  /** The derived inventory, when the source parsed into elements; absent on derivation failure. */
  readonly inventory?: Inventory;
  /** Elements skipped as oversized: never judged; every skip named in-band, not counted. */
  readonly oversized: readonly OversizedElement[];
  /** Per-rule scoping (issue 008): scoped-out element counts, never silent. */
  readonly notes: string[];
}

/**
 * The run-wide in-flight-call ceiling. Measured, not guessed: 16 sustained 53.9 rps, zero 429s,
 * median 283ms / p95 380ms (probe over 300 real core elements, 2026-09-28). Quota and pacing are
 * the caller's run-wide wrapper's job; a second cap here could never bind.
 */
export const DEFAULT_CONCURRENCY = 16;

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
 * THE target grammar — the routes from a rule's target to elements. One implementation serves BOTH
 * selection tiers, so a target's element mapping can never drift between them. Oversized elements
 * are never judged — the size backstop trades their readings for the run's reliability; every skip
 * is named in-band.
 */
export function matchesTarget(target: string, element: TargetableElement): boolean {
  if (element.oversized === true) return false;
  const carriesComment = element.role === "comment" || (element.attachedComment?.length ?? 0) > 0;
  switch (target) {
    case "comments":
      return carriesComment;
    case "functions":
      return element.role === "function";
    case "definitions":
      return element.role !== "comment" && element.role !== "import";
    case "imports":
      return element.role === "import";
    default:
      return false;
  }
}

/** Per-rule scoping (issue 008): a scoped-out rule/element pair costs zero classifier calls. */
export const rulesForElement = (
  rules: readonly Rule[],
  element: WalkElement,
  path?: string,
): Rule[] =>
  rules.filter(
    (rule) =>
      matchesTarget(rule.target, element) && (path === undefined || ruleInScope(rule, path)),
  );

export interface ClassifyFileOptions {
  /** Explicit grammar override; when absent the language comes from the state path's extension. */
  readonly language?: string;
}

/**
 * The walk phase, extracted: read + parse + extract the inventory (metadata + parent links), free
 * the tree. The lint pipeline walks every file unit ONCE up front and hands the result back, so
 * nothing ever re-walks.
 */
export interface WalkedUnit {
  readonly inventory: WalkElement[];
  readonly derived?: Inventory;
  /** Why the unit could not be mapped to elements (file units only); streamed as an error. */
  readonly failed: string | null;
  readonly failedCause: unknown;
}

function missingGrammarReason(unit: Unit): string {
  // The message names the remedy: a file extension can gain a grammar mapping (sweep coverage);
  // a str unit has nothing to map, so the caller declares the language.
  return unit.kind === "file"
    ? "no grammar mapping for extension"
    : "cannot infer a grammar for piped stdin - declare it with --language";
}

export async function walkUnit(unit: Unit, options: ClassifyFileOptions = {}): Promise<WalkedUnit> {
  if (unit.kind !== "file")
    return { inventory: [], failed: missingGrammarReason(unit), failedCause: undefined };
  const state = unit.state;
  const language = options.language ?? languageOf(state.path);
  if (language === null)
    return { inventory: [], failed: missingGrammarReason(unit), failedCause: undefined };
  // FileState.content is required and every unit carries it (file.ts, dir.ts, strUnit, the
  // retention pass) — a typed read, no union discriminator and no fallback to parse around.
  const source = state.content;
  try {
    const parsedSource = await decompose(source, language);
    const inventory = [
      ...parsedSource.definitions,
      ...parsedSource.comments,
      ...parsedSource.imports,
    ];
    if (inventory.length === 0)
      return {
        inventory,
        failed:
          "no definitions, comments, or imports found — element-target rules cannot measure this file (per-rule exclude it if that is intentional)",
        failedCause: undefined,
      };
    return { inventory, derived: parsedSource, failed: null, failedCause: undefined };
  } catch (thrown) {
    return { inventory: [], failed: "parse failed", failedCause: thrown };
  }
}

function elementContent(element: WalkElement): string {
  // A docstring out of context always reads like narration; naming what it documents restores the
  // reading "as written".
  const docstringLead = element.docstringOf
    ? [
        `docstring of ${element.docstringOf.kind}${element.docstringOf.name ? ` ${element.docstringOf.name}` : ""}:`,
      ]
    : [];
  return [...docstringLead, ...(element.attachedComment ?? []), element.content].join("\n");
}

interface ClassifierReply {
  readonly answers: Record<string, ClassifiedAnswer>;
  readonly error: ClassifyError | null;
}

/** One classifier call; failures convert to a streamed ClassifyError (the seam's code survives). */
async function askClassifier(
  state: AnyState,
  questions: Record<string, QuestionSchema>,
  classifier: Classifier,
  input: string,
): Promise<ClassifierReply> {
  try {
    return { answers: await classifier(state, questions), error: null };
  } catch (thrown) {
    return { answers: {}, error: toClassifyError(input, thrown) };
  }
}

/**
 * Emit one unit-level call's answers. Answers are keyed by question id; the rule name is the id's
 * prefix before the block id.
 */
function emitWholeUnitMeasurements(
  events: ClassifyEvent[],
  element: Element,
  unitReply: ClassifierReply,
  questionIds: readonly string[],
  input: string,
): void {
  if (unitReply.error !== null) {
    events.push({ event: unitReply.error });
    return;
  }
  for (const questionId of questionIds) {
    const answer = unitReply.answers[questionId];
    const rule = questionId.slice(0, questionId.indexOf(" in "));
    if (!isUsableAnswer(answer)) {
      events.push({ event: invalidAnswerError(input, rule, answer) });
      continue;
    }
    events.push({ event: measurementFields(rule, input, answer!), element });
  }
}

/**
 * Whole-unit rules: files-target rules are relational claims judged over the whole unit. A
 * piped-string unit is its own inventory — the whole input is the element, so EVERY rule judges it
 * whole; a target routes elements of a parsed inventory, and a piped-string unit has none by
 * design. No grammar is ever inferred for it.
 */
function wholeUnitRules(rules: readonly Rule[], path: string, kind: UnitKind): Rule[] {
  return rules.filter((rule) => ruleInScope(rule, path) && judgesWholeUnit(rule, kind));
}

/**
 * Per-rule scoping (issue 008): scoped-out pairs cost zero calls, but they are SIGNAL. One
 * aggregated note per unit (review 396888e finding 4: per-unit-per-rule notes inherit the rules x
 * files fan-out and drown the stream) lists each scoped rule and what it skipped. The path is
 * constant within a unit, so every scoped rule is either in scope for the whole unit or out for all
 * of it.
 */
function scopeNotesFor(
  rules: readonly Rule[],
  inventory: readonly WalkElement[],
  path: string,
  kind: UnitKind,
): string[] {
  const noteParts: string[] = [];
  for (const rule of rules) {
    if (rule.include === undefined && rule.exclude === undefined) continue;
    if (ruleInScope(rule, path)) continue;
    if (judgesWholeUnit(rule, kind)) {
      noteParts.push(`rule '${rule.name}' scope excluded the whole unit`);
      continue;
    }
    const scopedOut = inventory.filter((element) => matchesTarget(rule.target, element)).length;
    if (scopedOut > 0) noteParts.push(`rule '${rule.name}' scope excluded ${scopedOut} element(s)`);
  }
  if (noteParts.length === 0) return [];
  return [`${path}: scope excluded - ${noteParts.join("; ")}`];
}

/**
 * The element a selector names: the one element whose span covers the line (start.line <= L <=
 * end.line; top-level spans are disjoint, so containment is unique). Undefined = nothing matches:
 * the caller reports in-band, never silence. (Element ids are run-scoped internals, never a
 * selector — the only public query is the line.)
 */
export function selectElement(
  inventory: readonly WalkElement[],
  selector: { readonly line: number },
): WalkElement | undefined {
  return inventory.find(
    (e) => e.span.start.line <= selector.line && selector.line <= e.span.end.line,
  );
}

/**
 * The elements a RANGE selector names: exactly the elements FULLY ENCLOSED in the inclusive span
 * [start, end] - deliberately dumb, no containing-expansion. A range partially overlapping an
 * element selects nothing from it (the two-partials-excluded case is the pinned regression); an
 * element enclosed exactly is selected. Order-preserving; empty = the caller reports the miss
 * in-band, never silence. (Element ids are run-scoped internals, never a selector.)
 */
export function selectElements(
  inventory: readonly WalkElement[],
  range: { readonly start: number; readonly end: number },
): WalkElement[] {
  return inventory.filter((e) => e.span.start.line >= range.start && e.span.end.line <= range.end);
}

interface ElementJob {
  /** Run-scoped uuidv4: state.id -> input suffix -> findings -> UI cells, never positional. */
  readonly id: string;
  readonly element: Element;
  readonly source: string;
  readonly rules: Rule[];
}

/**
 * One job per element with at least one scoped rule. Positional span ids shift on edits above and
 * collide across files; a run-scoped uuidv4 needs neither stability nor readability.
 */
function elementJobsFor(
  rules: readonly Rule[],
  inventory: readonly WalkElement[],
  path: string,
): ElementJob[] {
  const jobs: ElementJob[] = [];
  for (const element of inventory) {
    const scoped = rulesForElement(rules, element, path);
    if (scoped.length === 0) continue;
    jobs.push({
      id: crypto.randomUUID(),
      element: projectElement(element),
      source: elementContent(element),
      rules: scoped,
    });
  }
  return jobs;
}

/**
 * One element, one call, all of the element's rules batched inside. Returns true when an auth
 * failure ended the run.
 */
async function classifyElementJob(
  job: ElementJob,
  statePath: string,
  classifier: Classifier,
  events: ClassifyEvent[],
): Promise<boolean> {
  const input = `${statePath}#${job.id}`;
  const elementReply = await askClassifier(
    { path: statePath, source: job.source, id: job.id },
    compileElementQuestions(job.rules, job.element.kind),
    classifier,
    input,
  );
  if (elementReply.error !== null) {
    events.push({ event: elementReply.error });
    return elementReply.error.code === "JEV_AUTH";
  }
  for (const [rule, answer] of Object.entries(elementReply.answers)) {
    if (!isUsableAnswer(answer)) {
      events.push({ event: invalidAnswerError(input, rule, answer) });
      continue;
    }
    events.push({ event: measurementFields(rule, input, answer), element: job.element });
  }
  return false;
}

/**
 * Elements fan out as concurrent one-element calls; the in-flight ceiling and pace are the CALLER's
 * run-wide knobs. Work completes out of order; the report is sorted downstream for stable output.
 * Returns true when an auth failure aborted the remaining queue.
 */
async function runElementJobs(
  pendingJobs: readonly ElementJob[],
  statePath: string,
  classifier: Classifier,
  isAborted: () => boolean,
  events: ClassifyEvent[],
): Promise<boolean> {
  let nextJobIndex = 0;
  let authAborted = false;
  const drainQueue = async (): Promise<void> => {
    while (nextJobIndex < pendingJobs.length && !authAborted && !isAborted()) {
      const job = pendingJobs[nextJobIndex++]!;
      if (await classifyElementJob(job, statePath, classifier, events)) authAborted = true;
    }
  };
  await Promise.all(Array.from({ length: pendingJobs.length }, drainQueue));
  return authAborted;
}

/**
 * Unit-scoped rules are relational claims that judge the unit, never its elements. Returns true
 * when an auth failure ended the run.
 */
async function classifyWholeUnit(
  unit: Unit,
  rules: readonly Rule[],
  classifier: Classifier,
  events: ClassifyEvent[],
): Promise<boolean> {
  const state = unit.state;
  const wholeRules = wholeUnitRules(rules, state.path, unit.kind);
  if (wholeRules.length === 0) return false;
  const fileId = state.id;
  const unitReply = await askClassifier(
    state,
    compileRuleQuestions(wholeRules, fileId, unit.kind).questions,
    classifier,
    state.path,
  );
  emitWholeUnitMeasurements(
    events,
    fileElement(fileId, state.content),
    unitReply,
    wholeRules.map((rule) => questionKey(rule.name, fileId)),
    state.path,
  );
  return events.some(
    (streamed) => streamed.event instanceof ClassifyError && streamed.event.code === "JEV_AUTH",
  );
}

/**
 * A walk failure streams as an error — but ONLY when a rule on the unit needed the inventory.
 * Unit-scoped (files-target) rules judge the unit itself; an empty inventory is their healthy
 * state, not a failure (the css file tier and element-free shims measure fine without one).
 */
function collectWalkFailure(
  unit: Unit,
  walked: WalkedUnit,
  events: ClassifyEvent[],
  needed: boolean,
): void {
  if (!needed || walked.failed === null) return;
  // missing grammar on a FILE is sweep coverage, never an error: unsupported extensions
  // aggregate into the coverage note; explicit file selection fails earlier at the input
  // boundary, with the supported list. On a str unit it stays an error: declare --language.
  if (unit.kind === "file" && walked.failed.startsWith("no grammar mapping")) return;
  const state = unit.state;
  events.push({
    event: new ClassifyError(
      "WALK_FAILED",
      state.path,
      `cannot map to elements: ${walked.failed}`,
      // The cause rides the Error for debugging; renderers print only the message, bounded.
      walked.failedCause !== undefined ? { cause: walked.failedCause } : undefined,
    ),
  });
}

/**
 * The inventory's oversized elements, projected to identity + size: the skips are IN the inventory
 * already (flagged), so the report channel carries them verbatim instead of a count that loses who
 * was skipped.
 */
function oversizedElements(inventory: Inventory | undefined): OversizedElement[] {
  if (inventory === undefined) return [];
  return [...inventory.definitions, ...inventory.comments, ...inventory.imports]
    .filter((e) => e.oversized === true)
    .map((e) => ({ label: e.label, role: e.role, span: e.span, chars: e.content.length }));
}

/**
 * One pass over a unit, no candidacy: every measurement is a reading the rule's handle judges.
 *
 * No fallback: a file that maps to no elements yields no element classification and its
 * inventory-scoped rules fail with a per-unit walk error. Unit-scoped rules judge the unit itself;
 * their target never needed parsing.
 *
 * REGRESSION BAN — the state x question MATRIX form (array state with many questions) is banned: it
 * makes the judge answer every question from the file's average, not the element (readings pinned
 * 0.61-0.66 across 21 elements whose per-element readings spread 0.60-0.92). Hence ONE element per
 * call, all of that element's rules batched inside, elements fanned out by concurrency.
 */
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

  if (await classifyWholeUnit(unit, rules, classifier, events))
    return { events, fatal: true, oversized: [], notes: [] };

  // Walk-first: lint already walked every file unit; reuse verbatim. Without a passed-in walk
  // (the one-shot door), walk now. Only file units stream the failure — a str unit has no
  // grammar to fail on by construction.
  const walkedUnit = walked ?? (await walkUnit(unit, options));
  // the walk is only load-bearing for inventory-scoped rules; files-tier units measure without it
  const needsInventory = rules.some(
    (rule) => ruleInScope(rule, state.path) && !judgesWholeUnit(rule, unit.kind),
  );
  collectWalkFailure(unit, walkedUnit, events, needsInventory);

  const notes = scopeNotesFor(rules, walkedUnit.inventory, state.path, unit.kind);
  const oversized = oversizedElements(walkedUnit.derived);
  if (isAborted()) return { events, fatal: false, oversized, notes };
  const elementJobs = elementJobsFor(rules, walkedUnit.inventory, state.path);
  if (elementJobs.length === 0) return { events, fatal: false, oversized, notes };

  const authAborted = await runElementJobs(elementJobs, state.path, classifier, isAborted, events);
  return { events, fatal: authAborted, inventory: walkedUnit.derived, oversized, notes };
}
