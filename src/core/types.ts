/**
 * Core model nouns, strictly separated (tmp/design.md §1):
 *
 * - Sensor — the measuring mechanism: { name, description, inputTypes, handle }
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
 * A measuring mechanism: one System One judgment (noul) over a state, plus a handle that reads the
 * value.
 */
export interface Sensor {
  readonly name: string;
  /** The calibrated claim; compiles to the noul question's instructions. */
  readonly description: string;
  /** Which unit kinds this sensor can measure; the inferred input kind narrows which sensors run. */
  readonly inputTypes: readonly UnitKind[];
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
}

/** A measurement that mattered: it cleared the sensor's handle and carries the returned severity. */
export interface Signal {
  readonly sensor: string;
  readonly input: string;
  readonly value: number;
  readonly severity: Severity;
}

/** A per-unit operational failure (unreadable file, jev hiccup); one bad unit never kills the run. */
export interface Diagnostic {
  readonly input: string;
  readonly code: ErrorCode;
  readonly message: string;
}

/** State for file units — exactly the shape the model judges. */
export interface FileState {
  readonly path: string;
  readonly content: string;
}

/** State for diff units — the calibrated tmp/diff-v4 shape, so the validated numbers transfer. */
export interface DiffState {
  readonly path: string;
  readonly diff: string;
  readonly commit_message: string | null;
}

export type UnitState = FileState | DiffState;

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
  state: UnitState,
  questions: Record<string, QuestionSpec>,
) => Promise<Record<string, number>>;

/** What the lint pipeline streams. */
export type LintEvent =
  | { type: "measurement"; measurement: Measurement }
  | { type: "signal"; signal: Signal }
  | { type: "diagnostic"; diagnostic: Diagnostic };
