/**
 * Core model nouns, strictly separated (tmp/design.md §1):
 *
 * - Rule — the measuring mechanism: { name, criteria, target, handle }
 * - Measurement — the raw noul value from jev for (rule, input); always produced, never actionable by
 *   itself
 * - Signal — a measurement that cleared the rule's handle; the only actionable output
 * - MeasureError — a per-unit failure to produce a measurement: a failed request to the classifier,
 *   or a unit that could not be mapped to elements; carried in the stream as a value, never thrown
 *   past the pipeline, never failing the run by itself
 * - SetupError — a thrown setup/infrastructure failure (config, entrypoints, invariants)
 */

export type Severity = "error" | "warn";
/** Handle's return type: "error" | "warn" | null (null = silent). */
export type HandleResult = Severity | null;
/** Input kinds; "dir" exists only at inference time — dirs resolve to file units before measuring. */
export type InputKind = "file" | "dir" | "diff";
/** The kind of a resolved measuring unit. */
export type UnitKind = "file" | "diff";

/** Codes a thrown SetupError carries: setup/infrastructure failures. */
export type SetupErrorCode =
  | "CONFIG_INVALID"
  | "ENTRYPOINT_NOT_FOUND"
  | "ENTRYPOINT_UNREADABLE"
  | "NOT_SOURCE"
  | "INTERNAL";

/**
 * Codes a streamed MeasureError carries: per-unit failures to produce a measurement. JEV_* codes
 * name request-layer causes; WALK_FAILED names a unit that could not be mapped to elements.
 * INTERNAL lives in both unions: invariant violations throw SetupError("INTERNAL"), while a
 * classifier-adjacent failure of unknown shape streams as MeasureError("INTERNAL").
 */
export type MeasureErrorCode =
  | "JEV_AUTH"
  | "JEV_UNAVAILABLE"
  | "JEV_REQUEST_INVALID"
  | "JEV_RESPONSE_INVALID"
  | "WALK_FAILED"
  | "INTERNAL";

/**
 * A thrown setup/infrastructure failure: invalid config, missing/unreadable entrypoints, invariant
 * violations. A real thrown Error — it escapes the pipeline boundary, and the CLI maps its code to
 * exit codes exactly once (cli.ts).
 */
export class SetupError extends Error {
  constructor(
    readonly code: SetupErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SetupError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * A per-unit failure to produce a measurement: the request to the classifier failed (JEV_*), or the
 * unit could not be mapped to elements (WALK_FAILED). Either way no judgment exists for the unit.
 * One bad unit never kills the run and never fails it by itself — the error streams as a value and
 * the run is failed only by findings. The seam throws it and the pipeline catches it into the
 * stream; it never escapes the pipeline boundary (design §7).
 */
export class MeasureError extends Error {
  constructor(
    readonly code: MeasureErrorCode,
    readonly input: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "MeasureError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Which unit instance a rule judges (design.md §7.1): mapping an acquired file to units yields
 * target instances - one whole-file slice, N definition elements, M standalone comment elements, 1
 * merged import element - and the target selects which of them the rule's question runs over.
 * "diffs" is the raw unified-diff string of a diff unit, judged as one unit (quick path, design §4
 * Diff units).
 */
export type RuleTarget = "files" | "functions" | "definitions" | "comments" | "imports" | "diffs";

/** The judgment primitive a rule runs on. */
export type RuleKind = "noul" | "choice";

interface RuleBase {
  readonly name: string;
  /** Which unit instances this rule judges; the funnel routes on it (design.md §7.1). */
  readonly target: RuleTarget;
  /** Reads the value, decides whether it matters. */
  readonly handle: (value: number) => HandleResult;
}

/** A noul rule: one yes/no judgment; the value is the yes probability (0..1). */
export interface NoulRule extends RuleBase {
  /** Optional: noul is the default kind — rules predating the field omit it. */
  readonly kind?: "noul";
  /**
   * The calibrated rule, criteria-as-rule: what makes the unit a 1 and what makes it a 0 — boundary
   * cases belong in false. Passes straight through to the noul question's criteria; editing either
   * side is a re-calibration event, since thresholds are anchored to readings taken under the rule
   * text.
   */
  readonly criteria: { readonly true: string; readonly false: string };
}

/**
 * The rubric of a choice rule: at least two descriptions indexed by ordered score 0..N. Mapped onto
 * the SDK's ScoreQuestion — the rubric is ordered, so score is the right primitive (ChoiceQuestion,
 * for named unordered options, stays unused).
 */
export type ChoiceRubric = readonly [string, string, ...string[]];

/** A choice rule: one scored judgment over an ordered rubric; the value is the score (0..N). */
export interface ChoiceRule extends RuleBase {
  readonly kind: "choice";
  /** The ordered rubric; the question text lives in instructions. */
  readonly criteria: ChoiceRubric;
  /** The question sentence, judged per unit (noul rules use the generic UNIT_TASK instead). */
  readonly instructions: string;
}

/** A rule: one System One judgment over a state, plus a handle that reads the value. */
export type Rule = NoulRule | ChoiceRule;

/**
 * The raw noul value for (rule, input). Values pass through untouched — near 0.5 means undecided,
 * not medium.
 */
export interface Measurement {
  readonly rule: string;
  readonly input: string;
  readonly value: number;
  /** What was measured: the unit itself, or an element of its inventory. */
  readonly stage?: "file" | "element";
}

/** A measurement that mattered: it cleared the rule's handle and carries the returned severity. */
export interface Signal {
  readonly rule: string;
  readonly input: string;
  readonly value: number;
  readonly severity: Severity;
  /**
   * Exact element location for element-scoped signals: the identified element plus its byte/line
   * span into the source. Absent for files-target signals (relational, file-shaped).
   */
  readonly location?: { readonly input: string; readonly span: Span };
}

/** Exact location of a element: line+col points and byte offsets into the source. */
export interface Span {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
  readonly startByte: number;
  readonly endByte: number;
}

/** State for file units — exactly the shape the model judges. */
export interface FileState {
  readonly path: string;
  readonly content: string;
  /** Wire id for a whole file: its full LOC interval (see blockWireId). */
  readonly id: string;
}

/**
 * State for ONE element judgment: the element's source under its own name, plus the file path so
 * the model knows the enclosing context. Never batch elements into an array state - one state x
 * many questions makes jev answer every question from the file's average (probes: noul pinned
 * 0.61-0.66 across 21 elements whose isolated readings spread 0.60-0.92).
 */
export interface ElementState {
  readonly path: string;
  readonly source: string;
}

/** State for diff units — the calibrated tmp/diff-v4 shape, so the validated numbers transfer. */
export interface DiffState {
  readonly path: string;
  readonly diff: string;
  readonly commit_message: string | null;
}

export type UnitState = FileState | DiffState;
/** Everything the classifier may be handed: whole-file/diff units, plus single elements. */
export type AnyState = UnitState | ElementState;

/** A resolved thing to measure: its kind picks the rules; its state feeds the classifier. */
export interface Unit {
  readonly kind: UnitKind;
  readonly state: UnitState;
}

/**
 * The documented noul question (docs: primitives/noul); structurally compatible with the SDK's
 * NoulQuestion — the jev adapter owns the real SDK type. `instructions` maps unit ids to their task
 * sentence ({[unitId]: task}; criteria-as-rule: the rule lives in criteria, not here); `criteria`
 * describes what true and false mean. Question ids (the record keys) are never sent to the model —
 * they only correlate answers.
 */
export interface NoulQuestionSpec {
  readonly type: "noul";
  readonly instructions: string;
  readonly criteria?: { readonly true: string; readonly false: string };
}

/** A scored question; structurally compatible with the SDK's ScoreQuestion. */
export interface ScoreQuestionSpec {
  readonly type: "score";
  readonly instructions: string;
  readonly criteria: ChoiceRubric;
}

export type QuestionSpec = NoulQuestionSpec | ScoreQuestionSpec;

/**
 * The swappable backend seam: answers keyed by question name. Implemented by jev/client.ts; faked
 * in tests.
 */
export type Classifier = (
  state: AnyState,
  questions: Record<string, QuestionSpec>,
) => Promise<Record<string, number>>;

/** What the lint pipeline streams. */
export type LintEvent =
  | { type: "measurement"; measurement: Measurement }
  | { type: "signal"; signal: Signal }
  | { type: "error"; error: MeasureError };
