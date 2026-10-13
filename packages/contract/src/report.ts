/**
 * The jint machine report payload shapes, as plain interfaces for consumers (the engine's TypeBox
 * schemas remain the validation truth; a type-level identity check in the engine pins the two
 * together, so this file cannot drift from the wire format).
 */

import type { Severity } from "./handlers.ts";

/** Exact location of an element: line+col points and byte offsets into the source. */
export interface Span {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
  readonly startByte: number;
  readonly endByte: number;
}

/** The construct a docstring documents; name is empty for the module. */
export interface DocstringOwner {
  readonly kind: "module" | "function" | "class";
  readonly name: string;
}

/** Shared projection shape of every element: where it is, its label, its parent. */
interface ElementBase {
  readonly span: Span;
  /** Stable positional walk label ("d0", "c0", "i0"); render-only, never a join key. */
  readonly label: string;
  /** The enclosing element's walk label, when this element sits inside one. */
  readonly parent?: string;
}

/** A whole unit judged as one — a unit AND an element (glossary). */
export interface FileElement extends ElementBase {
  readonly kind: "file";
}

export interface FunctionElement extends ElementBase {
  readonly kind: "function";
  /** The declared name, when the walker could extract one. */
  readonly name?: string;
}

export interface TypeElement extends ElementBase {
  readonly kind: "type";
  readonly name?: string;
}

/** A name bound to a non-callable, non-type value. */
export interface BindingElement extends ElementBase {
  readonly kind: "binding";
  readonly name?: string;
}

export interface ImportElement extends ElementBase {
  readonly kind: "import";
}

export interface CommentElement extends ElementBase {
  readonly kind: "comment";
  /** For a docstring element: the module/class/function it documents. */
  readonly docstringOf?: DocstringOwner;
}

/**
 * The typed subject of a measurement (tmp/designs/element.md): a closed discriminated union — the
 * projection of the walked element (kind, span, label, parent, kind-specific name), never its full
 * content. A whole-unit judgment carries FileElement.
 */
export type Element =
  | FileElement
  | FunctionElement
  | TypeElement
  | BindingElement
  | ImportElement
  | CommentElement;

/**
 * The full typed answer a classifier returns for one question: the value always; the score
 * distribution (per-level probabilities, confidence) only when the question is score-kind — noul's
 * probability IS the whole answer (no separate confidence).
 */
export interface ClassifiedAnswer {
  readonly value: number;
  readonly probabilities?: Record<string, number>;
  readonly confidence?: number;
}

/** One judged reading: a rule's value at one input (file or element). */
export interface Measurement {
  readonly rule: string;
  readonly input: string;
  readonly value: number;
  /**
   * The score distribution, score rules only: the per-level probabilities and confidence the value
   * summarizes. Noul has no separate distribution — its probability IS the value.
   */
  readonly probabilities?: Record<string, number>;
  readonly confidence?: number;
  /**
   * The measured subject: what was classified, fully typed. Absent only from the bare classifyUnit
   * generator, which sees no source and so cannot span a FileElement — every report path (lint,
   * one-shot classify) attaches it.
   */
  readonly element?: Element;
}

/**
 * A reading that crossed its handle's threshold: the actionable output. Score findings carry the
 * chosen rubric level's legend text as note (score rules only) so the report is self-contained.
 */
export interface Finding {
  readonly rule: string;
  readonly input: string;
  readonly value: number;
  readonly severity: Severity;
  /**
   * The custom-tier callback's remediation instruction to the caller fixing the finding: severity
   * says whether, message says how. Absent for noul and score (threshold-derived) findings.
   */
  readonly message?: string;
  /**
   * Exact element location for element-scoped findings: the element's input plus its byte/line span
   * into the source. Absent for files-target findings (relational, file-shaped).
   */
  readonly location?: { readonly input: string; readonly span: Span };
  /**
   * The chosen rubric level's legend text, score rules only: the report is self-contained. Absent
   * for noul findings and policy findings.
   */
  readonly note?: string;
}

/** A reading that could not happen: acquisition or classification failed for one input. */
export interface ClassifyErrorInfo {
  readonly input: string;
  readonly code: string;
  readonly message: string;
}

/** The jint machine report document. */
export interface Report {
  readonly tool: "jint";
  readonly version: string;
  readonly measurements: readonly Measurement[];
  readonly findings: readonly Finding[];
  readonly errors: readonly ClassifyErrorInfo[];
  readonly notes: readonly string[];
}
