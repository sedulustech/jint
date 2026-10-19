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

/**
 * The construct a docstring documents; name is empty for the module. kind is the OWNER CAPTURE,
 * open: the six shared definition kinds are the common values, but an autonomous capture may own a
 * comment in its grammar (its capture name arrives here losslessly) - the wire never crashes a BYOG
 * grammar on a closed enum.
 */
export interface DocstringOwner {
  readonly kind: string;
  readonly name: string;
}

/**
 * THE element-kind vocabulary, runtime face: one entry per Element union member, in union order.
 * The union below stays the compile-time face; the two pins (compile-time at the union, runtime in
 * the sdk) make adding a kind without touching both a loud failure, not drift.
 */
export const elementKinds = [
  "file",
  "function",
  "method",
  "class",
  "type",
  "binding",
  "comment",
  "import",
] as const;
export type ElementKind = (typeof elementKinds)[number];
// COMPILE-TIME PIN, one direction: every runtime kind names a valid element kind. The reverse
// stays open by design - an autonomous capture's kind is its capture name (a string), so the
// union cannot enumerate it; the .scm that declares the capture owns its wire face.
type _KindsMatch = [ElementKind] extends [Element["kind"]] ? true : never;
const _kindsPin: _KindsMatch = true;
/** Shared projection shape of every element: where it is, its label, its parent. */
interface ElementBase {
  /**
   * The element's name when its grammar binds one (@name): a definition's identifier, a section's
   * heading text. Absent for unnamed shapes (a paragraph, an import run).
   */
  readonly name?: string;
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

/** A class-like unit (the @class capture): classes judged as classes. */
export interface ClassElement extends ElementBase {
  readonly kind: "class";
  readonly name?: string;
}

/** A member function (the @method capture): a method of its class. */
export interface MethodElement extends ElementBase {
  readonly kind: "method";
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

/**
 * A GRAMMAR-AUTONOMOUS element (the open capture namespace): any capture a grammar's own .scm
 * declares - its kind is its capture name, its name rides when a pattern binds @name (markdown's
 * section, paragraph, list, list_item ride this shape today). One generic member, never a
 * per-capture type: the .scm that declares the capture defines its wire face.
 */
export interface AutonomousElement extends ElementBase {
  readonly kind: string & {};
  readonly name?: string;
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
  | ClassElement
  | MethodElement
  | TypeElement
  | BindingElement
  | ImportElement
  | CommentElement
  | AutonomousElement;

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
 * A reading that crossed its handle's threshold: the actionable output. The note is the rule
 * author's message attached at the fired handle tier (any handle form); absent = a bare finding -
 * classifier-adjacent rubric prose never reaches findings.
 */
export interface Finding {
  readonly rule: string;
  readonly input: string;
  readonly value: number;
  readonly severity: Severity;
  /**
   * The answer's certainty (jev's score answers; 1 = concentrated, 0 = torn between distant
   * levels). Copied from the finding's measurement whenever the answer carried one; absent when the
   * answer had none (noul answers, callback tiers).
   */
  readonly confidence?: number;
  /** The full distribution the value summarizes (one probability per criterion option). */
  readonly probabilities?: Record<string, number>;
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
   * The rule author's message attached at the fired handle tier. Absent by default - default rules
   * carry no messages (authoring them is a deliberate, calibration-gated pass).
   */
  readonly note?: string;
}

/**
 * The run's self-description of one rule that ran: its name, its criteria text, and the compiled
 * handle tiers (thresholds / score map, including any author message). NOT instructions - criteria
 * plus tiers suffice to read a finding; instructions stay provenance-of-the-config. handle is null
 * for a custom-tier callback rule (a code policy has no declarative tier form).
 */
export interface RuleDigest {
  readonly name: string;
  /**
   * Null for a custom-tier callback rule: its policy is code, not text - the criteria live in the
   * config source, which is the provenance for these rules.
   */
  readonly criteria: readonly string[] | { readonly true: string; readonly false: string } | null;
  readonly handle: import("./handlers.ts").HandlerData | null;
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
