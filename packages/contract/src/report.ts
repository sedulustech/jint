/**
 * The jint-report/v1 payload shapes, as plain interfaces for consumers (the engine's TypeBox
 * schemas remain the validation truth; a type-level identity check in the engine pins the two
 * together, so this file cannot drift from the wire format).
 */

/** One judged reading: a rule's value at one input (file or element). */
export interface Measurement {
  readonly rule: string;
  readonly input: string;
  readonly value: number;
  readonly stage?: "file" | "element";
}

/**
 * A reading that crossed its handle's threshold: the actionable output. Findings carry NO message -
 * consumers join by rule id to the config (v1 contract).
 */
export interface Finding {
  readonly rule: string;
  readonly input: string;
  readonly value: number;
  readonly severity: "error" | "warn";
  /** Optional extra structured data, attached by a policy callback (schema-validated). */
  readonly data?: Record<string, unknown>;
}

/** A reading that could not happen: acquisition or classification failed for one input. */
export interface ClassifyErrorInfo {
  readonly input: string;
  readonly code: string;
  readonly message: string;
}

/** The jint-report/v1 document. */
export interface Report {
  readonly tool: "jint";
  readonly format: string;
  readonly version: string;
  readonly measurements: readonly Measurement[];
  readonly findings: readonly Finding[];
  readonly errors: readonly ClassifyErrorInfo[];
  readonly notes: readonly string[];
}
