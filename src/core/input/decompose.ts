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
}

/** Per-language role mapping: what counts as a definition, comment, import, wrapper. */
/**
 * The language-independent noun a grammar node abstracts into. Rules and the classifier route on
 * roles, never on grammar node names — adding a language is adding one roleTable entry, never
 * touching the walker (design: language adapter, measured in tmp/langsurvey).
 */
export type NodeRole = "function" | "type" | "import" | "comment";

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
    // lexical_declaration: const f = () => {}; data consts judged as functions in v0
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
};

const WASM_PATHS: Record<string, string> = {
  typescript: typescriptWasm,
  python: pythonWasm,
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
  if (!tree) return { hasError: true, definitions: [], comments: [], imports: [] };

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
    definitions.push({
      label: "",
      span: spanOf(outer),
      content: outer.text,
      nodeType: type,
      role,
      ...(attached ? { attachedComment: attached } : {}),
      internalCommentCount: countInternalComments(node),
    });
    // The construct's docstring becomes its own measurable comment element, owned by it.
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
      const role = mapping.roleTable[type];
      if (role === "function" || role === "type") {
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
      const role = mapping.roleTable[type];
      if (role === "function" || role === "type") {
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

  const label = (elements: RawElement[], prefix: string) =>
    elements.map((element, i) => ({ ...element, label: prefix + String(i) }));
  return {
    hasError: tree.rootNode.hasError,
    definitions: label(definitions, "d"),
    comments: label(comments, "c"),
    imports: importElement ? [importElement] : [],
  };
}

/** The inventory's languages: the tree-sitter grammars actually mapped (design §7.2). */
export function languageOf(path: string): string | null {
  if (/\.(m|c)?tsx?$/.test(path)) return "typescript";
  return /\.py$/.test(path) ? "python" : null;
}
