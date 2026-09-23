/**
 * Tree-sitter-based mapping of a source file into a unit inventory (tmp/design.md §7.2):
 * definitions, comments, and imports, top-level only.
 *
 * Extraction is flag-independent: which files are acquired is decided elsewhere; the parse and the
 * inventory are identical always. The inventory is pure data — no linting, no jev calls — so Stage
 * 2's funnel can consume it unchanged.
 *
 * Graceful degradation: a file whose parse sets rootNode.hasError still yields whatever top-level
 * elements parsed (tree-sitter recovers per-node, so partial structure survives). Unparseable
 * stretches surface as ERROR nodes, which the walker skips; everything that did parse is accounted
 * for. This matters for future diff hunks, which routinely parse partially.
 *
 * Adding a language = adding its prebuilt grammar wasm + one LANGUAGES entry; the walker is written
 * against roles, not node names.
 */

import { Language, Parser, type Language as LanguageType } from "web-tree-sitter";
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

/** Unwrap wrapper nodes (export_statement -> inner declaration); type becomes the role. */
function unwrap(
  node: { type: string; namedChildren: any[] },
  wrappers: readonly string[],
): { node: any; type: string } {
  let current = node;
  while (wrappers.includes(current.type)) {
    const inner = current.namedChildren[0];
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
 * The language-independent noun a grammar node abstracts into. Rules and the funnel route on roles,
 * never on grammar node names — adding a language is adding one roleTable entry, never touching the
 * walker (design: language adapter, measured in tmp/langsurvey).
 */
export type NodeRole = "function" | "type" | "import" | "comment";

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
    interface_declaration: "type",
    type_alias_declaration: "type",
    enum_declaration: "type",
    comment: "comment",
    import_statement: "import",
    ts_import_equals_declaration: "import",
  },
  wrapperTypes: ["export_statement"],
};

const LANGUAGES: Record<string, LanguageMapping> = {
  typescript: TYPESCRIPT,
};

const WASM_PATHS: Record<string, string> = {
  typescript: "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm",
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
      locateFile: (file: string) => "node_modules/web-tree-sitter/" + file,
    });
    await initPromise;
    const lang: LanguageType = await Language.load(wasm);
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

  for (const child of tree.rootNode.namedChildren) {
    // Unwrap wrappers, but keep the top-level node's span and text: content must stay
    // complete ("export" and all), spans must stay exact.
    const { node, type } = unwrap(child, mapping.wrapperTypes);
    if (mapping.roleTable[type] === "comment") {
      pending.push({ text: node.text, span: spanOf(node) });
      continue;
    }
    if (mapping.roleTable[type] === "import") {
      flushStandalone();
      importNodes.push({ nodeType: type, text: node.text, span: spanOf(node) });
      continue;
    }
    const role = mapping.roleTable[type];
    if (role === "function" || role === "type") {
      // A comment run attaches only when it directly precedes the declaration
      // with no blank line in between; otherwise it stays standalone.
      const last = pending.at(-1);
      const gap = last ? child.startPosition.row - (last.span.end.line - 1) : Infinity;
      const attach = pending.length > 0 && gap <= 1;
      if (attach) {
        definitions.push({
          label: "",
          span: spanOf(child),
          content: child.text,
          nodeType: type,
          role,
          attachedComment: pending.map((p) => p.text),
          internalCommentCount: countInternalComments(node),
        });
        pending = [];
      } else {
        flushStandalone();
        definitions.push({
          label: "",
          span: spanOf(child),
          content: child.text,
          nodeType: type,
          role,
          internalCommentCount: countInternalComments(node),
        });
      }
      continue;
    }
    flushStandalone();
  }
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
