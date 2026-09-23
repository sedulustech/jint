/**
 * Core model nouns, strictly separated (tmp/design.md §1):
 *
 * - Rule — the measuring mechanism: { name, criteria, target, handle }
 * - Measurement — the raw noul value from jev for (rule, input); always produced, never actionable by
 *   itself
 * - Signal — a measurement that cleared the rule's handle; the only actionable output
 * - RequestError — a per-unit failure of the request to the judge: no judgment ever exists for the
 *   unit; carried in the stream as a value, never thrown past the pipeline
 * - Degradation — a per-unit degradation: the unit still measured, but degraded (a value, never an
 *   Error — nothing failed)
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
  | "INTERNAL";

/**
 * Codes a streamed RequestError carries: per-unit failures of the request exchange with the judge.
 * INTERNAL lives in both unions: invariant violations throw SetupError("INTERNAL"), while a
 * judge-adjacent failure of unknown shape streams as RequestError("INTERNAL").
 */
export type RequestErrorCode =
  | "JEV_AUTH"
  | "JEV_UNAVAILABLE"
  | "JEV_REQUEST_INVALID"
  | "JEV_RESPONSE_INVALID"
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
 * A per-unit failure of the request to the judge (jev hiccup, unmeasurable unit): the request
 * itself failed, so no judgment ever exists for the unit. One bad unit never kills the run. The
 * judge seam throws it on transport/shape failures and the pipeline catches it and carries it in
 * the stream — it never escapes the pipeline boundary (design §7). Every RequestError is a failure:
 * the unit produced no measurement.
 */
export class RequestError extends Error {
  constructor(
    readonly code: RequestErrorCode,
    readonly input: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "RequestError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Codes a streamed Degradation carries. */
export type DegradationCode = "MAPPING_DEGRADED";

/**
 * A per-unit degradation: the unit still measured, but degraded (e.g. measured whole instead of
 * per-leaf). A plain value — never thrown, never an Error, nothing failed; a run never exits
 * non-zero for a degradation.
 */
export interface Degradation {
  readonly input: string;
  readonly code: DegradationCode;
  readonly message: string;
}

/**
 * Which unit instance a rule judges (design.md §7.1): mapping an acquired file to units yields
 * target instances - one whole-file slice, N definition leaves, M standalone comment leaves, 1
 * merged import leaf - and the target selects which of them the rule's question runs over. "diffs"
 * is the raw unified-diff string of a diff unit, judged as one unit (quick path, design §4 Diff
 * units).
 */
export type RuleTarget = "files" | "functions" | "definitions" | "comments" | "imports" | "diffs";

/**
 * A measuring mechanism: one System One judgment (noul) over a state, plus a handle that reads the
 * value.
 */
export interface Rule {
  readonly name: string;
  /**
   * The calibrated rule, criteria-as-rule: what makes the unit a 1 and what makes it a 0 — boundary
   * cases belong in false. Passes straight through to the noul question's criteria; editing either
   * side is a re-calibration event, since thresholds are anchored to readings taken under the rule
   * text.
   */
  readonly criteria: { readonly true: string; readonly false: string };
  /** Which unit instances this rule judges; the funnel routes on it (design.md §7.1). */
  readonly target: RuleTarget;
  /** Reads the value, decides whether it matters: v => v < 0.4 ? "error" : v < 0.6 ? "warn" : null. */
  readonly handle: (value: number) => HandleResult;
}

/**
 * The raw noul value for (rule, input). Values pass through untouched — near 0.5 means undecided,
 * not medium.
 */
export interface Measurement {
  readonly rule: string;
  readonly input: string;
  readonly value: number;
  /** Which funnel regime produced it (absent = whole-unit path). */
  readonly stage?: "file" | "sweep" | "confirm";
}

/** A measurement that mattered: it cleared the rule's handle and carries the returned severity. */
export interface Signal {
  readonly rule: string;
  readonly input: string;
  readonly value: number;
  readonly severity: Severity;
  /**
   * Exact leaf location for confirmed funnel signals (design.md §7.3): the identified block plus
   * its byte/line span into the source. Absent for files-target signals (relational, file-shaped).
   */
  readonly location?: { readonly input: string; readonly span: Span };
}

/** Exact location of a leaf: line+col points and byte offsets into the source. */
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

/** One block of the sweep's array state (design.md §7.7); id is the content-hashed wire id. */
export interface SweepBlock {
  /** LOC-interval wire id (treesitter span); reports address blocks by the same id. */
  readonly id: string;
  readonly content: string;
}

/** Stage-1 sweep state: one file mapped into an array of blocks, judged in ONE call. */
export interface SweepState {
  readonly path: string;
  readonly blocks: readonly SweepBlock[];
}

/** State for diff units — the calibrated tmp/diff-v4 shape, so the validated numbers transfer. */
export interface DiffState {
  readonly path: string;
  readonly diff: string;
  readonly commit_message: string | null;
}

export type UnitState = FileState | DiffState;
/** Everything the judge may be handed: whole-file/diff units, plus the sweep's array state. */
export type AnyState = UnitState | SweepState;

/** A resolved thing to measure: its kind picks the rules; its state feeds the judge. */
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
export interface QuestionSpec {
  readonly type: "noul";
  readonly instructions: Readonly<Record<string, string>>;
  readonly criteria?: { readonly true: string; readonly false: string };
}

/**
 * The swappable backend seam: answers keyed by question name. Implemented by jev/client.ts; faked
 * in tests.
 */
export type Judge = (
  state: AnyState,
  questions: Record<string, QuestionSpec>,
) => Promise<Record<string, number>>;

/** What the lint pipeline streams. */
export type LintEvent =
  | { type: "measurement"; measurement: Measurement }
  | { type: "signal"; signal: Signal }
  | { type: "error"; error: RequestError }
  | { type: "degradation"; degradation: Degradation };
