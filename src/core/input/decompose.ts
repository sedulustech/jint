/**
 * Tree-sitter-based mapping of a source file into a unit inventory (tmp/design.md §7.2):
 * definitions, comments, and imports — top-level nodes, plus composite descent (composites are
 * judged AND descended into, so nested definitions become elements of their own).
 *
 * Extraction is flag-independent: which files are acquired is decided elsewhere; the parse and the
 * inventory are identical always. The inventory is pure data — no linting, no jev calls — so
 * classification consumes it unchanged.
 *
 * Graceful degradation: a file whose parse sets rootNode.hasError still yields whatever top-level
 * elements parsed (tree-sitter recovers per-node, so partial structure survives). Unparseable
 * stretches surface as ERROR nodes, which the walker skips; everything that did parse is accounted
 * for. This matters for future diff hunks, which routinely parse partially.
 *
 * Adding a language = adding its prebuilt grammar wasm + one LANGUAGES entry; the walker is written
 * against roles, not node names.
 */

import goWasm from "tree-sitter-go/tree-sitter-go.wasm" with { type: "file" };
import pythonWasm from "tree-sitter-python/tree-sitter-python.wasm" with { type: "file" };
import typescriptWasm from "tree-sitter-typescript/tree-sitter-typescript.wasm" with { type: "file" };
import { Language, Parser, type Language as LanguageType } from "web-tree-sitter";
// Grammar wasms as bundled assets: file paths when running from source, embedded ($bunfs) paths
// inside the compiled binary — Bun.file reads both, so one loader serves both run modes.
import treeSitterWasm from "web-tree-sitter/web-tree-sitter.wasm" with { type: "file" };
import { SetupError } from "../types.ts";

/** One-based line, zero-based column — raw tree-sitter position semantics. */
export interface UnitPoint {
  readonly line: number;
  readonly column: number;
}

/** Exact location of a element: line+col points and byte offsets into the source. */
export interface UnitSpan {
  readonly start: UnitPoint;
  readonly end: UnitPoint;
  readonly startByte: number;
  readonly endByte: number;
}

/** A element of the inventory; src.slice(span.startByte, span.endByte) === content. */
export interface InventoryElement {
  /** Stable positional label: "d0", "d1", "c0", "i0". */
  readonly label: string;
  readonly span: UnitSpan;
  readonly content: string;
  readonly nodeType: string;
  /** The abstracted noun this element is ("function" | "type" for definitions; "comment"). */
  readonly role: NodeRole;
  /** The comment node(s) consumed into this definition's leading run (outside its content span). */
  readonly attachedComment?: readonly string[];
  /**
   * For a docstring element: the module/class/function it documents — an orphan docstring never
   * exists.
   */
  readonly docstringOf?: DocstringOwner;
  /** Comment nodes nested inside this definition's body; consumed into the element by construction. */
  readonly internalCommentCount: number;
  /** The element's source exceeded MAX_ELEMENT_CHARS: never judged, counted in-band. */
  readonly oversized?: boolean;
}

/** Comment nodes anywhere inside a node's subtree (member docs, function-body comments). */
function countInternalComments(node: { type: string; namedChildren: any[] }): number {
  let count = 0;
  const walk = (n: { type: string; namedChildren: any[] }): void => {
    for (const child of n.namedChildren) {
      if (child.type === "comment") count++;
      walk(child);
    }
  };
  walk(node);
  return count;
}

/**
 * The single node -> final role pass: (a) the per-language role table lookup, then (b) value-aware
 * refinement — a binding is a NAME BOUND TO A NON-CALLABLE, NON-TYPE VALUE (const/let/var with a
 * non-callable initializer, e.g. `const report = buildReport()`); a callable initializer
 * (arrow_function / function_expression) keeps the function role — it has a body and reads like a
 * function. Functions-target rules never judge bindings; definitions-target rules do (they must —
 * is_name_purposeful judges const names).
 */
export function resolveRole(
  type: string,
  node: any,
  roleTable: Readonly<Record<string, NodeRole>>,
): NodeRole | undefined {
  const role = roleTable[type];
  if (role === undefined || role !== "function") return role;
  if (type !== "lexical_declaration" && type !== "variable_declaration") return role;
  const declarator = node.namedChildren.find((c: any) => c.type === "variable_declarator");
  const value = declarator?.namedChildren.at(-1);
  return value !== undefined &&
    (value.type === "arrow_function" || value.type === "function_expression")
    ? "function"
    : "binding";
}

/**
 * Unwrap wrapper nodes (export_statement -> inner declaration, decorated_definition -> its
 * definition); type becomes the role. Decoration and comments are not the wrapper's payload, so
 * they are skipped when picking the inner declaration.
 */
function unwrap(
  node: { type: string; namedChildren: any[] },
  wrappers: readonly string[],
): { node: any; type: string } {
  let current = node;
  while (wrappers.includes(current.type)) {
    const inner = current.namedChildren.find(
      (c: any) => c.type !== "decorator" && c.type !== "comment",
    );
    if (!inner) break;
    current = inner;
  }
  return { node: current, type: current.type };
}

/** The structured unit inventory for one file (design.md §7.2). */
export interface Inventory {
  /** True when tree-sitter flagged the parse (partial syntax); the yielded elements are still exact. */
  readonly hasError: boolean;
  readonly definitions: InventoryElement[];
  readonly comments: InventoryElement[];
  /** Exactly one merged element when the file has imports; empty otherwise. */
  readonly imports: InventoryElement[];
  /** Elements emitted with oversized: true (source over MAX_ELEMENT_CHARS); reported, never judged. */
  readonly oversizedCount: number;
}

/**
 * Hard size backstop (language-agnostic): any element whose source exceeds this is emitted with
 * oversized: true and skipped by the classifier — ordinary code can never crash the run with an
 * oversized judgment request (design: composite body-size fix). Chunking is rejected.
 */
export const MAX_ELEMENT_CHARS = 8000;

/** Per-language role mapping: what counts as a definition, comment, import, wrapper. */
/**
 * The language-independent noun a grammar node abstracts into. Rules and the classifier route on
 * roles, never on grammar node names — adding a language is adding one roleTable entry, never
 * touching the walker (design: language adapter, classified in tmp/langsurvey).
 */
export type NodeRole = "function" | "type" | "binding" | "import" | "comment";

/** The construct a docstring documents; name is empty for the module. */
export interface DocstringOwner {
  readonly kind: "module" | "function" | "class";
  readonly name: string;
}

interface LanguageMapping {
  /** Grammar node type -> abstract role. Unlisted top-level node types are skipped. */
  readonly roleTable: Readonly<Record<string, NodeRole>>;
  /** Wrapper nodes unwrapped to their inner declaration (e.g. export_statement). */
  readonly wrapperTypes: readonly string[];
}

const TYPESCRIPT: LanguageMapping = {
  roleTable: {
    function_declaration: "function",
    generator_function_declaration: "function",
    // Variable declarations refine to "function" only when the value is a callable body
    // (arrow/function expression); non-callable consts are bindings — functions rules judge callables.
    lexical_declaration: "function",
    variable_declaration: "function",
    class_declaration: "type",
    abstract_class_declaration: "type",
    method_definition: "function",
    // Call expressions (describe(...)/it(...) and the like) are composites: emitted as function
    // elements AND descended into — see the composite-descent note in decompose().
    call_expression: "function",
    interface_declaration: "type",
    type_alias_declaration: "type",
    enum_declaration: "type",
    comment: "comment",
    import_statement: "import",
    ts_import_equals_declaration: "import",
  },
  // expression_statement unwraps to the call it wraps (top-level describe(...); etc.).
  wrapperTypes: ["export_statement", "expression_statement"],
};

const PYTHON: LanguageMapping = {
  roleTable: {
    function_definition: "function",
    class_definition: "type",
    comment: "comment",
    import_statement: "import",
    import_from_statement: "import",
    future_import_statement: "import",
    // Docstrings are NOT in the role table: they are extracted structurally (first body statement
    // of a module/class/function, see docstringOf) so every docstring element carries its owner —
    // a detached docstring always reads like narration to the classifier.
  },
  // expression_statement unwraps to the bare expression it wraps (docstring strings, etc.).
  wrapperTypes: ["decorated_definition", "expression_statement"],
};

const GO: LanguageMapping = {
  roleTable: {
    function_declaration: "function",
    // Methods with receivers are Go's function_definition-equivalent; like Go itself, they sit at
    // the top level (not nested in the type), so no composite descent applies.
    method_declaration: "function",
    // type_declaration wraps one or more type_spec (struct/interface/alias); its full text is the
    // element content.
    type_declaration: "type",
    // Package-level const/var blocks are Go's bindings; without them a consts-only file (e.g. a
    // protocol-constants package file) yields an empty inventory and the dir walk reports
    // WALK_FAILED for it.
    const_declaration: "binding",
    var_declaration: "binding",
    comment: "comment",
    import_declaration: "import",
  },
  wrapperTypes: [],
};

/**
 * The docstring of a python construct: the FIRST statement of its body wrapping a string. Returns
 * the string node's text and span, or null when there is no docstring. The "block" body node type
 * is python-specific, so this is null for every other language's definitions.
 */
function docstringOf(node: { namedChildren: any[] }): { text: string; span: UnitSpan } | null {
  const body = node.namedChildren.find((c: any) => c.type === "block");
  const first = body?.namedChildren[0];
  if (!first) return null;
  const inner = first.type === "expression_statement" ? first.namedChildren[0] : first;
  if (!inner || inner.type !== "string") return null;
  return { text: inner.text, span: spanOf(inner) };
}

/** The declared name of a python function/class definition (empty when anonymous/odd parse). */
function defName(node: { namedChildren: any[] }): string {
  return node.namedChildren.find((c: any) => c.type === "identifier")?.text ?? "";
}

const LANGUAGES: Record<string, LanguageMapping> = {
  typescript: TYPESCRIPT,
  python: PYTHON,
  go: GO,
};

/** The grammar ids --language accepts, in mapping order (design §7.2). */
export function knownLanguages(): string[] {
  return Object.keys(LANGUAGES);
}

const WASM_PATHS: Record<string, string> = {
  typescript: typescriptWasm,
  python: pythonWasm,
  go: goWasm,
};

/** Parser instances are cached per language; web-tree-sitter itself initializes once. */
let initPromise: Promise<unknown> | null = null;
const parsers = new Map<string, Promise<Parser>>();

async function parserFor(language: string): Promise<Parser> {
  const cached = parsers.get(language);
  if (cached) return cached;
  const wasm = WASM_PATHS[language];
  if (!LANGUAGES[language] || !wasm) {
    throw new SetupError("INTERNAL", `no tree-sitter grammar mapped for language: ${language}`);
  }
  const created = (async () => {
    initPromise ??= Parser.init({
      // Bun quirk: Emscripten resolves the .wasm relative to the JS shim unless redirected.
      locateFile: () => treeSitterWasm,
    });
    await initPromise;
    const lang: LanguageType = await Language.load(
      new Uint8Array(await Bun.file(wasm).arrayBuffer()),
    );
    return new Parser().setLanguage(lang);
  })();
  parsers.set(language, created);
  return created;
}

interface RawElement {
  readonly label: string;
  readonly span: UnitSpan;
  readonly content: string;
  readonly nodeType: string;
  readonly role: NodeRole;
  readonly attachedComment?: readonly string[];
  readonly docstringOf?: DocstringOwner;
  readonly internalCommentCount: number;
  /** The element's source exceeded MAX_ELEMENT_CHARS: never judged, counted in-band. */
  readonly oversized?: boolean;
}

function spanOf(node: {
  startIndex: number;
  endIndex: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
}): UnitSpan {
  return {
    start: { line: node.startPosition.row + 1, column: node.startPosition.column },
    end: { line: node.endPosition.row + 1, column: node.endPosition.column },
    startByte: node.startIndex,
    endByte: node.endIndex,
  };
}

/** End point len chars after start (content === src.slice(startByte, endByte) invariant). */
function pointAfter(start: UnitPoint, content: string): UnitPoint {
  const lines = content.split("\n");
  const last = lines[lines.length - 1]!;
  return {
    line: start.line + lines.length - 1,
    column: lines.length === 1 ? start.column + last.length : last.length,
  };
}

/**
 * Composite header state: the byte offset bounding a composite's source to its declaration — the
 * first '{' at the top level of the node text (name, signature, decorator, docstring line); when
 * the grammar has no braces (python's "class Greeter:"), the first top-level ':' ends the header
 * (inclusive). A single-line declaration with neither keeps its full text. Depth-tracked, so a '{'
 * inside a decorator call or a signature's object type never ends the header early.
 */
function headerEnd(text: string, nestedBraceEndsHeader: boolean): number {
  let depth = 0;
  let colon = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "{") {
      // A class body's brace sits at top level; a call composite's callback brace sits one
      // paren deep (describe("x", () => {) — either ends the header.
      if (depth === 0 || (nestedBraceEndsHeader && depth === 1)) return i;
      depth++;
    } else if (c === "}") {
      if (depth > 0) depth--;
    } else if (c === ":" && depth === 0 && colon === -1) colon = i;
  }
  return colon === -1 ? text.length : colon + 1;
}

/**
 * Decompose one source string into its unit inventory. Never throws for parse errors — see the
 * module doc on graceful degradation.
 */
export async function decompose(source: string, language: string): Promise<Inventory> {
  const mapping = LANGUAGES[language];
  if (!mapping) {
    throw new SetupError("INTERNAL", `no tree-sitter grammar mapped for language: ${language}`);
  }
  const parser = await parserFor(language);
  const tree = parser.parse(source);
  if (!tree)
    return { hasError: true, definitions: [], comments: [], imports: [], oversizedCount: 0 };

  const definitions: RawElement[] = [];
  const comments: RawElement[] = [];
  const importNodes: Array<{ nodeType: string; text: string; span: UnitSpan }> = [];
  // Comments awaiting a definition to attach to, in document order.
  let pending: Array<{ text: string; span: UnitSpan }> = [];
  const flushStandalone = () => {
    for (const p of pending)
      comments.push({
        label: "",
        content: p.text,
        nodeType: "comment",
        role: "comment",
        span: p.span,
        internalCommentCount: 0,
      });
    pending = [];
  };

  // Emit one element for a definition node (composite or not). Content stays the complete
  // node text; inner elements yielded by descent have sub-spans — containment stays implicit.
  const emit = (
    outer: any,
    node: any,
    type: string,
    role: NodeRole,
    attached?: readonly string[],
  ) => {
    let content = outer.text;
    let span = spanOf(outer);
    // Composite header state (design: composite body-size fix): composites carry their declaration
    // through the opening brace, not their body (real corpora hit jev's max_tokens on 25k-char
    // impl/class bodies). Body facts travel via the children descent already yields; the parent's
    // questions are about the declaration. The attached doc comment travels outside the span, so
    // it survives the bound.
    if (COMPOSITES.has(type)) {
      const end = headerEnd(content, type === "call_expression");
      if (end < content.length) {
        content = content.slice(0, end).trimEnd();
        span = {
          ...span,
          end: pointAfter(span.start, content),
          endByte: span.startByte + content.length,
        };
      }
    }
    definitions.push({
      label: "",
      span,
      content,
      nodeType: type,
      role,
      ...(attached ? { attachedComment: attached } : {}),
      internalCommentCount: countInternalComments(node),
    });
    // The construct's docstring becomes its own classifiable comment element, owned by it.
    const docstring = docstringOf(node);
    if (docstring) {
      comments.push({
        label: "",
        content: docstring.text,
        nodeType: "string",
        role: "comment",
        span: docstring.span,
        internalCommentCount: 0,
        docstringOf: {
          kind: type === "class_definition" ? "class" : "function",
          name: defName(node),
        },
      });
    }
  };

  // Composite descent: a composite (class declaration, call expression like describe(...)/it(...),
  // and nested composites recursively) is BOTH judged and descended into — its header is emitted
  // as a regular element (role per node type) AND its body is walked so inner nodes become
  // elements too. Spans stay LOC intervals; identity is span-derived; containment is implicit.
  // Anonymous callbacks (arrow_function/function_expression) and block/argument containers are
  // descent glue: recursed, never emitted.
  //
  // Depth cap: syntax trees cannot cycle, but pathologically deep nesting (describe inside
  // describe inside ...) should not walk unbounded; composites deeper than this stay header-only.
  const MAX_DESCENT_DEPTH = 8;
  const DESCENT_CONTAINERS = new Set([
    "arguments",
    "statement_block",
    "class_body",
    "block",
    "arrow_function",
    "function_expression",
    "pair",
  ]);
  const COMPOSITES = new Set([
    "class_declaration",
    "abstract_class_declaration",
    "class_definition",
    "call_expression",
  ]);
  const descend = (node: any, depth: number): void => {
    if (depth > MAX_DESCENT_DEPTH) return;
    for (const child of node.namedChildren) {
      const { node: inner, type } = unwrap(child, mapping.wrapperTypes);
      const role = resolveRole(type, inner, mapping.roleTable);
      if (role !== undefined && role !== "comment" && role !== "import") {
        emit(child, inner, type, role);
        // Nested composite: emitted as a header AND descended into, recursively.
        if (COMPOSITES.has(type)) {
          descend(inner, depth + 1);
        }
        continue;
      }
      if (DESCENT_CONTAINERS.has(type)) {
        descend(inner, depth + 1);
      }
    }
  };

  const walk = (node: any, topLevel: boolean): void => {
    const children = node.namedChildren;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      // Unwrap wrappers, but keep the node's span and text: content must stay
      // complete ("export" and all), spans must stay exact.
      const { node: inner, type } = unwrap(child, mapping.wrapperTypes);
      // Module docstring: the file's FIRST statement wrapping a string, owned by the module.
      if (topLevel && i === 0 && type === "string") {
        comments.push({
          label: "",
          content: inner.text,
          nodeType: "string",
          role: "comment",
          span: spanOf(inner),
          internalCommentCount: 0,
          docstringOf: { kind: "module", name: "" },
        });
        continue;
      }
      if (topLevel && mapping.roleTable[type] === "comment") {
        pending.push({ text: inner.text, span: spanOf(inner) });
        continue;
      }
      if (mapping.roleTable[type] === "import") {
        flushStandalone();
        importNodes.push({ nodeType: type, text: inner.text, span: spanOf(inner) });
        continue;
      }
      const role = resolveRole(type, inner, mapping.roleTable);
      if (role !== undefined && role !== "comment" && role !== "import") {
        // A comment run attaches only when it directly precedes the declaration
        // with no blank line in between; otherwise it stays standalone.
        const last = pending.at(-1);
        const gap = last ? child.startPosition.row - (last.span.end.line - 1) : Infinity;
        const attach = topLevel && pending.length > 0 && gap <= 1;
        if (attach) {
          emit(
            child,
            inner,
            type,
            role,
            pending.map((p) => p.text),
          );
          pending = [];
        } else {
          flushStandalone();
          emit(child, inner, type, role);
        }
        // Composite: judged AND descended into (class -> type role; call -> function role).
        if (COMPOSITES.has(type)) {
          descend(inner, 1);
        }
        continue;
      }
      if (!topLevel && DESCENT_CONTAINERS.has(type)) {
        walk(inner, false);
        continue;
      }
      flushStandalone();
    }
  };
  walk(tree.rootNode, true);
  flushStandalone();

  let importElement: InventoryElement | undefined;
  if (importNodes.length > 0) {
    const first = importNodes[0]!;
    const last = importNodes.at(-1)!;
    importElement = {
      label: "i0",
      // Span covers the first through last import node.
      span: {
        start: first.span.start,
        end: last.span.end,
        startByte: first.span.startByte,
        endByte: last.span.endByte,
      },
      content: importNodes.map((n) => n.text).join("\n"),
      nodeType: first.nodeType,
      role: "import",
      internalCommentCount: 0,
    };
  }

  // Hard size backstop (language-agnostic, design: composite body-size fix): any element over
  // MAX_ELEMENT_CHARS is flagged oversized — the classifier returns no rules for it and the run
  // reports the count in-band. Ordinary code can never crash the run with an oversized request.
  const sized = (elements: readonly RawElement[]): RawElement[] =>
    elements.map((e) => (e.content.length > MAX_ELEMENT_CHARS ? { ...e, oversized: true } : e));
  const importElements = importElement ? [importElement] : [];
  const sizedDefs = sized(definitions);
  const sizedComments = sized(comments);
  const sizedImports = sized(importElements);
  const oversizedCount = [...sizedDefs, ...sizedComments, ...sizedImports].filter(
    (e) => e.oversized === true,
  ).length;
  const label = (elements: RawElement[], prefix: string) =>
    elements.map((element, i) => ({ ...element, label: prefix + String(i) }));
  return {
    hasError: tree.rootNode.hasError,
    definitions: label(sizedDefs, "d"),
    comments: label(sizedComments, "c"),
    imports: label(sizedImports, "i"),
    oversizedCount,
  };
}

/** The inventory's languages: the tree-sitter grammars actually mapped (design §7.2). */
export function languageOf(path: string): string | null {
  if (/\.(m|c)?tsx?$/.test(path)) return "typescript";
  if (/\.py$/.test(path)) return "python";
  return /\.go$/.test(path) ? "go" : null;
}
