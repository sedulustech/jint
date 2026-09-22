/**
 * Core model nouns, strictly separated (tmp/design.md §1):
 *
 * - Sensor — the measuring mechanism: { name, description, target, handle }
 * - Measurement — the raw noul value from jev for (sensor, input); always produced, never actionable
 *   by itself
 * - Signal — a measurement that cleared the sensor's handle; the only actionable output
 * - Diagnostic — a per-unit operational failure carried in the stream, never thrown past the pipeline
 */

export type Severity = "error" | "warn";
/** Handle's return type: "error" | "warn" | null (null = silent). */
export type HandleResult = Severity | null;
/** Input kinds; "dir" exists only at inference time — dirs resolve to file units before measuring. */
export type InputKind = "file" | "dir" | "diff";
/** The kind of a resolved measuring unit. */
export type UnitKind = "file" | "diff";

export type ErrorCode =
  | "CONFIG_INVALID"
  | "ENTRYPOINT_NOT_FOUND"
  | "ENTRYPOINT_UNREADABLE"
  | "JEV_AUTH"
  | "JEV_UNAVAILABLE"
  | "JEV_REQUEST_INVALID"
  | "JEV_RESPONSE_INVALID"
  | "DECOMPOSITION_DEGRADED"
  | "INTERNAL";

/**
 * One base error type; variants differ by typed `code`, not by class
 * (typescript/error-handling.md).
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
  readonly isOperational = true;
}

/**
 * Which decomposition instance a sensor judges (design.md §7.1): decomposition of an acquired file
 * yields target instances - one whole-file slice, N definition leaves, M standalone comment leaves,
 * 1 merged import leaf - and the target selects which of them the sensor's question runs over.
 * "diffs" is the diff blob itself (no sensor uses it yet).
 */
export type SensorTarget = "files" | "definitions" | "comments" | "imports" | "diffs";

/**
 * A measuring mechanism: one System One judgment (noul) over a state, plus a handle that reads the
 * value.
 */
export interface Sensor {
  readonly name: string;
  /** The calibrated claim; compiles to the noul question's instructions. */
  readonly description: string;
  /** Which decomposition instances this sensor judges; the funnel routes on it (design.md §7.1). */
  readonly target: SensorTarget;
  /** Reads the value, decides whether it matters: v => v < 0.4 ? "error" : v < 0.6 ? "warn" : null. */
  readonly handle: (value: number) => HandleResult;
}

/**
 * The raw noul value for (sensor, input). Values pass through untouched — near 0.5 means undecided,
 * not medium.
 */
export interface Measurement {
  readonly sensor: string;
  readonly input: string;
  readonly value: number;
  /** Which funnel regime produced it (absent = whole-unit path). */
  readonly stage?: "file" | "sweep" | "confirm";
}

/** A measurement that mattered: it cleared the sensor's handle and carries the returned severity. */
export interface Signal {
  readonly sensor: string;
  readonly input: string;
  readonly value: number;
  readonly severity: Severity;
  /**
   * Exact leaf location for confirmed funnel signals (design.md §7.3): the labeled block plus its
   * byte/line span into the source. Absent for files-target signals (relational, file-shaped).
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

/** A per-unit operational failure (unreadable file, jev hiccup); one bad unit never kills the run. */
export interface Diagnostic {
  readonly input: string;
  readonly code: ErrorCode;
  readonly message: string;
  /** "warn" diagnostics inform (e.g. degraded decomposition) and never fail the run. */
  readonly severity?: "error" | "warn";
}

/** State for file units — exactly the shape the model judges. */
export interface FileState {
  readonly path: string;
  readonly content: string;
}

/** One block of the sweep's array state (design.md §7.7); label is "block-N", positional. */
export interface SweepBlock {
  readonly label: string;
  readonly content: string;
}

/** Stage-1 sweep state: one file mapped into an array of labeled blocks, judged in ONE call. */
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

/** A resolved thing to measure: its kind picks the sensors; its state feeds the judge. */
export interface Unit {
  readonly kind: UnitKind;
  readonly state: UnitState;
}

/** Structurally compatible with the SDK's NoulQuestion; the jev adapter owns the real SDK type. */
export interface QuestionSpec {
  readonly type: "noul";
  readonly instructions: string | Record<string, string>;
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
  | { type: "diagnostic"; diagnostic: Diagnostic };
