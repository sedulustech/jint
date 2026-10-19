/**
 * The core nouns, strictly separated — each declaration below carries its own contract: the
 * classifying mechanism, the raw reading it always produces (never actionable by itself), the
 * reading that cleared its policy (the only actionable output), the streamed per-unit failure to
 * produce a reading (carried as a value, never thrown past the pipeline), the thrown
 * setup/infrastructure failure (optionally carrying structured detail the consumer renders into
 * prose), and the bug/escape-hatch bucket: the error that says "this is jint's fault, not the
 * invocation's".
 */

/**
 * One verdict word list for the whole toolchain: defined beside the wire vocabulary it annotates,
 * re-exported here — never redefined locally.
 */
export type { Severity } from "@jint/contract";
import type { RuleTarget, Severity } from "@jint/contract";
export type { RuleTarget };
/**
 * Readings stay raw probabilities — whether one fires is the policy's decision, never baked into
 * the value.
 */
export interface HandleOutcome {
  readonly severity: Severity;
  /** The rule author's message attached at the fired tier; the finding's note. Absent = bare. */
  readonly message?: string;
}
/** Null is a deliberate silent verdict: the reading happened, nothing surfaces. */
export type HandleResult = HandleOutcome | null;
/** Input kinds; "dir" exists only at inference time — dirs resolve to file units before classifying. */
export type InputKind = "file" | "dir";
/** The kind of a resolved classifying unit. */
export type UnitKind = "file" | "str";

/**
 * Codes a thrown SetupError carries: setup/infrastructure failures. The declared path-list read
 * (the paths noun) splits by where the judgment is possible: unreadable bytes are an I/O judgment,
 * thrown where the bytes are read (the CLI; the SDK takes already-read text); malformed entries and
 * an empty list are judgments of the parsed data, thrown SDK-side from the text alone. Invariant
 * violations are NOT here — they belong to the bug bucket instead.
 */
export type SetupErrorCode =
  | "CONFIG_INVALID"
  | "CONFIG_NO_RULES"
  | "ENTRYPOINT_NOT_FOUND"
  | "ENTRYPOINT_UNREADABLE"
  | "LIST_UNREADABLE"
  | "LIST_ENTRY_INVALID"
  | "LIST_EMPTY"
  | "MISSING_GRAMMAR"
  | "RULE_INVALID"
  | "ELEMENT_NOT_FOUND";

/**
 * Structured data a SetupError may carry: WHAT was wrong, as data — never the prose a terminal
 * prints (the consumer's emitter renders that). Present iff the throw site knows the structure.
 * `suggest` is the only optional field: a closest match legitimately may not exist.
 */
export type SetupDetail =
  | { kind: "unknown-rule"; valid: readonly string[]; suggest?: string }
  | { kind: "unknown-language"; valid: readonly string[] }
  | { kind: "invalid-rule"; ruleIndex: number; field: string; present: boolean };

/**
 * Codes a streamed per-unit failure carries: request-layer causes (auth, availability, request and
 * response shape, timeout), a unit that could not be mapped to elements, and a custom rule's
 * handler throwing mid-run — per-unit, non-fatal, the run continues. INTERNAL is the escape hatch:
 * a classifier-adjacent failure of unknown shape streams under it; a thrown invariant violation is
 * the bug bucket instead, never a streamed code.
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
 * exit codes exactly once, at the CLI boundary.
 */
export class SetupError extends Error {
  /** Structured data for consumers that render it; absent when the throw site has none. */
  readonly detail?: SetupDetail;
  constructor(
    readonly code: SetupErrorCode,
    message: string,
    options?: { cause?: unknown; detail?: SetupDetail },
  ) {
    super(message, options);
    this.name = "SetupError";
    if (options?.detail !== undefined) this.detail = options.detail;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The bug/escape-hatch bucket (HTTP 500's shape): an invariant violation, an impossible state, or
 * an unknown-shaped thrown failure — the error that says the RUNNER is broken, not the invocation.
 * Its code is only ever "INTERNAL" and it carries no detail: a bug has no structure to render.
 */
export class InternalError extends Error {
  /** The one code this bucket carries; rendered like any other code downstream. */
  readonly code = "INTERNAL";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "InternalError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * A per-unit failure to produce a measurement: the request to the classifier failed (JEV_*), or the
 * unit could not be mapped to elements (WALK_FAILED). Either way no judgment exists for the unit.
 * One bad unit never kills the run and never fails it by itself — the error streams as a value and
 * the run is failed only by findings. The seam throws it and the pipeline catches it into the
 * stream; it never escapes the pipeline boundary.
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

/** The rule target vocabulary is defined beside the wire vocabulary it annotates, re-exported here. */

/** The judgment primitive: a calibrated yes/no reading or an ordered rubric score. */
export type RuleKind = "noul" | "choice";

interface RuleBase {
  readonly name: string;
  /**
   * Which unit instances this rule judges; the funnel routes on it (design.md §7.1). A list is the
   * explicit form (the defaults use it); a single name is the one-target shorthand.
   */
  readonly target: RuleTarget | readonly RuleTarget[];
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
   * The yes/no question the model answers, specific to the rule's claim. REQUIRED: a generic
   * fallback question would silently recalibrate every reading. The compiler prepends the
   * element-kind sentence, so the question never leaves the judged object implicit. Changing a
   * rule's instructions is a recalibration event: readings move.
   */
  readonly instructions: string;
  /**
   * The calibrated question, criteria-as-rule: what makes the unit a yes and what makes it a no —
   * boundary cases belong on the no side. Passes straight through to the question; editing either
   * side is a recalibration event, since thresholds are anchored to readings taken under this
   * text.
   */
  readonly criteria: { readonly true: string; readonly false: string };
}

/**
 * The rubric of a choice rule: at least two descriptions indexed by ordered score 0..N. The rubric
 * is ordered, so the scored question is the right primitive; the named-option question form stays
 * unused.
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
   * The measured subject, fully typed: the element projection — kind, span, label, parent,
   * kind-specific name. A whole-unit judgment is a file element (a file IS an element), so there is
   * no parallel unit string. The span is the stable sort key and the display source — the uuid
   * input is identity, never presentation.
   */
  readonly element?: Element;
}

/**
 * A measurement that mattered: it cleared the rule's policy and carries the returned severity.
 * value is the JUDGED value on the defect pole (inverted when the rule fires on no), so value and
 * severity always agree under the rule's own thresholds. message is the custom-tier callback's
 * remediation instruction (revision of the no-message contract: severity says whether, message says
 * how — rendered beneath the finding line) — absent for threshold-derived findings.
 */
export interface Finding {
  readonly rule: string;
  readonly input: string;
  readonly value: number;
  readonly severity: Severity;
  /**
   * The answer's certainty, copied from the finding's measurement when the answer carried one
   * (score answers): 1 = concentrated, 0 = torn between distant levels (bimodal). Absent when the
   * answer had none (noul answers, callback tiers).
   */
  readonly confidence?: number;
  /** The full distribution the value summarizes: one probability per criterion option. */
  readonly probabilities?: Record<string, number>;
  /**
   * Additive (custom tier): a policy callback's remediation instruction to the caller
   * (schema-validated at the callback boundary). Absent for threshold-derived findings.
   */
  readonly message?: string;
  /**
   * Exact element location for element-scoped findings: the identified element plus its byte/line
   * span into the source. Absent for whole-file findings.
   */
  readonly location?: { readonly input: string; readonly span: Span };
  /**
   * The rule author's message attached at the fired handle tier; absent = a bare finding. The
   * criteria legend echo is gone: rubric prose never reaches findings.
   */
  readonly note?: string;
}

/** Exact location of an element: line+col points and byte offsets into the source. */
export type Span = import("@jint/contract").Span;
/** The typed subject of a measurement: the closed element union. */
export type Element = import("@jint/contract").Element;
/**
 * An element's capture name: THE OPEN NAMESPACE - a shared capture (the lingua franca) or a
 * grammar-declared autonomous one (its kind on the wire). Cannot derive from Element["kind"]
 * anymore: the union's open string member swallows every literal under Exclude. "file" is not a
 * capture (files-target rules judge whole units, never walk elements).
 */
export type ElementCapture = string;
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
  /** Wire id for a whole file: its full LOC interval (the same wire-id form elements use). */
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
 * The documented yes/no question; structurally compatible with the classifier's question shape —
 * the adapter owns the real vendor type. Instructions map unit ids to their task sentences
 * (criteria-as-rule: the rule lives in the criteria, not here); criteria describe what true and
 * false mean. Question ids (the record keys) are never sent to the model — they only correlate
 * answers.
 */
export interface NoulQuestionSchema {
  readonly type: "noul";
  readonly instructions: string;
  readonly criteria?: { readonly true: string; readonly false: string };
}

export interface ScoreQuestionSchema {
  readonly type: "score";
  readonly instructions: string;
  readonly criteria: ChoiceRubric;
}

export type QuestionSchema = NoulQuestionSchema | ScoreQuestionSchema;

/**
 * Jint's reexport of the classifier's answer type for a rule: the raw answer, structurally the
 * vendor response shape — the TS policy callback's input, aligned with the rule's targets by index.
 * noul-only in v1.
 */
export type NoulResult = { readonly type: "noul"; readonly noul: number };
export type ScoreResult = { readonly type: "score"; readonly score: number };
export type RuleResult = NoulResult | ScoreResult;

/**
 * The swappable backend seam: answers keyed by question name. Implemented by the jev adapter; faked
 * in tests.
 */
export type Classifier = (
  state: AnyState,
  questions: Record<string, QuestionSchema>,
) => Promise<Record<string, import("@jint/contract").ClassifiedAnswer>>;

export type { ClassifiedAnswer } from "@jint/contract";

/** What the lint pipeline streams. */
export type LintEvent =
  | { type: "measurement"; measurement: Measurement }
  | { type: "finding"; finding: Finding }
  | { type: "error"; error: ClassifyError }
  /** In-band degradation note (e.g. oversized elements skipped): not silent, not an error. */
  | { type: "note"; note: string }
  /** The run's rule self-descriptions: one digest per rule that ran, emitted once at run start. */
  | { type: "rules"; rules: import("@jint/contract").RuleDigest[] }
  /** The input accounting, emitted once after the walk resolves (run.input; the stderr line). */
  | { type: "input"; summary: import("./input/stats.ts").InputSummary };
