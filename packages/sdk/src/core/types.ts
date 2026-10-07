/**
 * Core model nouns, strictly separated (tmp/design.md §1):
 *
 * - Rule — the classifying mechanism: { name, criteria, target, handle }
 * - Measurement — the raw noul value from jev for (rule, input); always produced, never actionable by
 *   itself
 * - Finding — a measurement that cleared the rule's handle; the only actionable output
 * - ClassifyError — a per-unit failure to produce a measurement: a failed request to the classifier,
 *   or a unit that could not be mapped to elements; carried in the stream as a value, never thrown
 *   past the pipeline, never failing the run by itself
 * - SetupError — a thrown setup/infrastructure failure (config, entrypoints, invariants)
 */

export type Severity = "error" | "warn";
/** A fired reading: severity. Values stay RAW P(true) — fires_when lives in the rule config. */
export interface HandleOutcome {
  readonly severity: Severity;
}
/** Handle's return type: an outcome, or null (silent). */
export type HandleResult = HandleOutcome | null;
/** Input kinds; "dir" exists only at inference time — dirs resolve to file units before classifying. */
export type InputKind = "file" | "dir";
/** The kind of a resolved classifying unit. */
export type UnitKind = "file" | "str";

/**
 * Codes a thrown SetupError carries: setup/infrastructure failures. LIST_* names the declared
 * path-list read (jint paths -): LIST_UNREADABLE — bytes are not a path list — is an I/O judgment,
 * thrown where the bytes are read (the CLI; the SDK takes already-read text); LIST_ENTRY_INVALID
 * (an entry would need path interpretation) and LIST_EMPTY (no entries) are judgments of the parsed
 * data, thrown SDK-side from the text alone.
 */
export type SetupErrorCode =
  | "CONFIG_INVALID"
  | "CONFIG_NO_RULES"
  | "ENTRYPOINT_NOT_FOUND"
  | "ENTRYPOINT_UNREADABLE"
  | "LIST_UNREADABLE"
  | "LIST_ENTRY_INVALID"
  | "LIST_EMPTY"
  | "NOT_SOURCE"
  | "RULE_INVALID"
  | "ELEMENT_NOT_FOUND"
  | "INTERNAL";

/**
 * Codes a streamed ClassifyError carries: per-unit failures to produce a measurement. JEV_* codes
 * name request-layer causes; WALK_FAILED names a unit that could not be mapped to elements;
 * RULE_FAILED names a custom rule's mid-run throw (classify / target fn / handleClassification) —
 * per-unit, non-fatal, the run continues (design rules-context/01 §Errors). INTERNAL lives in both
 * unions: invariant violations throw SetupError("INTERNAL"), while a classifier-adjacent failure of
 * unknown shape streams as ClassifyError("INTERNAL").
 */
export type ClassifyErrorCode =
  | "JEV_AUTH"
  | "JEV_UNAVAILABLE"
  | "JEV_REQUEST_INVALID"
  | "JEV_RESPONSE_INVALID"
  | "JEV_TIMEOUT"
  | "WALK_FAILED"
  | "RULE_FAILED"
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
export class ClassifyError extends Error {
  constructor(
    readonly code: ClassifyErrorCode,
    readonly input: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ClassifyError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Which unit instance a rule judges (design.md §7.1): mapping an acquired file to units yields
 * target instances - one whole-file slice, N definition elements, M standalone comment elements, 1
 * merged import element - and the target selects which of them the rule's question runs over.
 */
export type RuleTarget = "files" | "functions" | "definitions" | "comments" | "imports";

/** The judgment primitive a rule runs on. */
export type RuleKind = "noul" | "choice";

interface RuleBase {
  readonly name: string;
  /** Which unit instances this rule judges; the funnel routes on it (design.md §7.1). */
  readonly target: RuleTarget;
  /** Reads the full answer, decides whether it matters. */
  readonly handle: (answer: import("@jint/contract").ClassifiedAnswer) => HandleResult;
  /**
   * The declarative data the handle was compiled from; absent when the handle is null or the rule
   * is custom-tier (code policy). This is what the run manifest snapshots.
   */
  readonly handleData?: import("@jint/contract").HandlerData;
  /** Per-rule scoping (issue 008): glob list; absent = the rule applies to all paths. */
  readonly include?: readonly string[];
  /** Per-rule scoping: glob list; ALWAYS wins over include. */
  readonly exclude?: readonly string[];
}

/** A noul rule: one yes/no judgment; the value is the yes probability (0..1). */
export interface NoulRule extends RuleBase {
  /** Optional: noul is the default kind — an omitted kind means noul. */
  readonly kind?: "noul";
  /**
   * The yes/no question the model answers, specific to the rule's claim. REQUIRED (config schema
   * enforces it): a generic fallback question would silently recalibrate every reading. The
   * compiler prepends a kind sentence ("This unit is a function definition.") — the question never
   * leaves the judged object implicit. Changing a rule's instructions is a recalibration event:
   * readings move.
   */
  readonly instructions: string;
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
  /** The question sentence, judged per unit; the compiler prepends the kind sentence to it. */
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
  readonly probabilities?: Record<string, number>;
  readonly confidence?: number;
  /**
   * The measured subject, fully typed (tmp/designs/element.md): the element projection — kind,
   * span, label, parent, kind-specific name. FileElement = the whole-unit judgment; a file IS an
   * element (glossary), so there is no parallel stage string. The span is the stable sort key
   * (report docs) and display source — the uuid input is identity, never presentation.
   */
  readonly element?: Element;
}

/**
 * A measurement that mattered: it cleared the rule's handle and carries the returned severity.
 * value is the JUDGED value on the defect pole (1-p when fires_when is "false"), so value and
 * severity always agree under the rule's own thresholds. Findings carry NO message: consumers join
 * by rule id to the config (report contract v1, 2026-09-28 — the never-promised score-criteria line
 * and callback message were dropped with this change).
 */
export interface Finding {
  readonly rule: string;
  readonly input: string;
  readonly value: number;
  readonly severity: Severity;
  /**
   * Additive (custom tier, rules-context/04): a policy callback's extra structured data,
   * schema-validated at the callback boundary. Absent for threshold-derived findings.
   */
  readonly data?: Record<string, unknown>;
  /**
   * Exact element location for element-scoped findings: the identified element plus its byte/line
   * span into the source. Absent for files-target findings (relational, file-shaped).
   */
  readonly location?: { readonly input: string; readonly span: Span };
  /**
   * The chosen rubric level's legend text, score rules only (v1.3, additive): the report is
   * self-contained, so a renderer never reaches into criteria or recorded requests for display.
   * Absent for noul findings and policy findings.
   */
  readonly note?: string;
}

/** Exact location of an element: line+col points and byte offsets into the source. */
export type Span = import("@jint/contract").Span;
/** The typed subject of a measurement: the closed element union (tmp/designs/element.md). */
export type Element = import("@jint/contract").Element;
export type FileElement = import("@jint/contract").FileElement;
export type FunctionElement = import("@jint/contract").FunctionElement;
export type TypeElement = import("@jint/contract").TypeElement;
export type BindingElement = import("@jint/contract").BindingElement;
export type ImportElement = import("@jint/contract").ImportElement;
export type CommentElement = import("@jint/contract").CommentElement;
export type DocstringOwner = import("@jint/contract").DocstringOwner;

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
  /** Identity: a uuidv4 minted at classify time, propagated unchanged (input, finding, cell). */
  readonly id: string;
}

export type UnitState = FileState;
/** Everything the classifier may be handed: whole-file units, plus single elements. */
export type AnyState = UnitState | ElementState;

/** A resolved thing to classify: its kind picks the rules; its state feeds the classifier. */
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
 * Jint's reexport of the jev answer type for a rule (design rules-context/04): the raw classifier
 * answer, structurally the vendor response shape — the TS policy callback's input, aligned with
 * ctx.targets by index. noul-only in v1.
 */
export type NoulResult = { readonly type: "noul"; readonly noul: number };
export type ScoreResult = { readonly type: "score"; readonly score: number };
export type RuleResult = NoulResult | ScoreResult;

/**
 * The swappable backend seam: answers keyed by question name. Implemented by jev/client.ts; faked
 * in tests.
 */
export type Classifier = (
  state: AnyState,
  questions: Record<string, QuestionSpec>,
) => Promise<Record<string, import("@jint/contract").ClassifiedAnswer>>;

export type { ClassifiedAnswer } from "@jint/contract";

/** What the lint pipeline streams. */
export type LintEvent =
  | { type: "measurement"; measurement: Measurement }
  | { type: "finding"; finding: Finding }
  | { type: "error"; error: ClassifyError }
  /** In-band degradation note (e.g. oversized elements skipped): not silent, not an error. */
  | { type: "note"; note: string };
