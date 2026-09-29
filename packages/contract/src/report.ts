/**
 * The jint-report/v1 payload shapes, as plain interfaces for consumers (the engine's TypeBox
 * schemas remain the validation truth; a type-level identity check in the engine pins the two
 * together, so this file cannot drift from the wire format).
 */

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
 * content. A whole-unit judgment carries FileElement; a diff-block variant opens only when a run
 * actually measures diffs.
 */
export type Element =
  | FileElement
  | FunctionElement
  | TypeElement
  | BindingElement
  | ImportElement
  | CommentElement;

/** One judged reading: a rule's value at one input (file or element). */
export interface Measurement {
  readonly rule: string;
  readonly input: string;
  readonly value: number;
  /** The measured subject: what was classified, fully typed. Absent only in pre-v1.1 reports. */
  readonly element?: Element;
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
