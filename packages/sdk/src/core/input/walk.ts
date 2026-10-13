/**
 * Tree-sitter-based mapping of a source file into a unit inventory: definitions, comments, and
 * imports — top-level nodes, plus composite descent (composites are judged AND descended into, so
 * nested definitions become elements of their own).
 *
 * Extraction is flag-independent: which files are acquired is decided elsewhere; the parse and the
 * inventory are identical always. The inventory is pure data — no linting, no classifier calls — so
 * classification consumes it unchanged.
 *
 * Graceful degradation: a file whose parse is flagged as partial still yields whatever top-level
 * elements parsed (tree-sitter recovers per-node, so partial structure survives). Unparseable
 * stretches surface as error nodes, which the walker skips; everything that did parse is accounted
 * for. This matters for any source that parses only partially.
 *
 * Adding a language = adding its prebuilt grammar wasm + one mapping entry; the walker is written
 * against roles, not node names.
 */

import goWasm from "tree-sitter-go/tree-sitter-go.wasm" with { type: "file" };
import pythonWasm from "tree-sitter-python/tree-sitter-python.wasm" with { type: "file" };
import tsxWasm from "tree-sitter-typescript/tree-sitter-tsx.wasm" with { type: "file" };
import typescriptWasm from "tree-sitter-typescript/tree-sitter-typescript.wasm" with { type: "file" };
import {
  Language,
  Parser,
  type Language as LanguageType,
  type Node as SyntaxNode,
} from "web-tree-sitter";
// Grammar wasms as bundled assets: file paths when running from source, embedded ($bunfs) paths
// inside the compiled binary — Bun.file reads both, so one loader serves both run modes.
import treeSitterWasm from "web-tree-sitter/web-tree-sitter.wasm" with { type: "file" };
import { SetupError, type DocstringOwner, type Element, type Span } from "../types.ts";
export type { DocstringOwner } from "../types.ts";

/** One-based line, zero-based column — raw tree-sitter position semantics. */
export interface UnitPoint {
  readonly line: number;
  readonly column: number;
}

/** An inventory element; slicing the source by its span bytes yields its content exactly. */
export interface WalkElement {
  /** Stable positional label: "d0", "d1", "c0", "i0". */
  readonly label: string;
  readonly span: Span;
  readonly content: string;
  readonly nodeType: string;
  /** The abstracted noun this element is; rules and the classifier route on it. */
  readonly role: NodeRole;
  /** The declared name, when the walker could extract one (render-only; never an id). */
  readonly name?: string;
  /**
   * The comment node(s) consumed into this definition: the leading run (outside its content span)
   * plus every comment inside its body. Both are comments OF the definition - comment-target rules
   * judge the full run, so a function whose only comment is internal is still a comment unit.
   */
  readonly attachedComment?: readonly string[];
  /** For a docstring element: what it documents; an orphan docstring never exists. */
  readonly docstringOf?: DocstringOwner;
  readonly internalCommentCount: number;
  /**
   * The enclosing element's label ("d3"), when this element sits inside one (a docstring inside its
   * function, a method inside a composite header's descent); absent at the top level. Hierarchy
   * travels with the element (design rules-context/02) — pairing reads it.
   */
  readonly parent?: string;
  /** The element's source exceeds the size backstop: never judged; named in-band. */
  readonly oversized?: boolean;
}

/** Every non-empty comment text inside the node's body, document order (recursively). */
function collectInternalComments(node: { type: string; namedChildren: SyntaxNode[] }): string[] {
  const texts: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "comment" && !isEmptyComment(child.text)) texts.push(child.text);
    texts.push(...collectInternalComments(child));
  }
  return texts;
}

/**
 * The node -> role pass with one refinement: a variable declaration whose initializer carries a
 * callable body keeps the function role; any other initializer is a binding. Function-target rules
 * never judge bindings; definition-target rules still do, so binding names stay measured.
 */
export function resolveRole(
  type: string,
  node: SyntaxNode,
  roleTable: Readonly<Record<string, NodeRole>>,
): NodeRole | undefined {
  const role = roleTable[type];
  const variableShaped = type === "lexical_declaration" || type === "variable_declaration";
  if (role !== "function" || !variableShaped) return role;
  const declarator = node.namedChildren.find((c) => c.type === "variable_declarator");
  const initializer = declarator?.namedChildren.at(-1);
  const initializerIsCallable =
    initializer?.type === "arrow_function" || initializer?.type === "function_expression";
  return initializerIsCallable ? "function" : "binding";
}

/**
 * Wrapper nodes (an export, a decorator) stand between the tree and the declaration they carry;
 * walk through to the payload, skipping decoration and comments on the way.
 */
function unwrap(node: SyntaxNode, wrappers: readonly string[]): { node: SyntaxNode; type: string } {
  let current = node;
  while (wrappers.includes(current.type)) {
    const inner = current.namedChildren.find((c) => c.type !== "decorator" && c.type !== "comment");
    if (!inner) break;
    current = inner;
  }
  return { node: current, type: current.type };
}

/** The structured unit inventory for one file. */
export interface Inventory {
  /** True when tree-sitter flagged the parse (partial syntax); the yielded elements are still exact. */
  readonly hasError: boolean;
  readonly definitions: WalkElement[];
  readonly comments: WalkElement[];
  /** Exactly one merged element when the file has imports; empty otherwise. */
  readonly imports: WalkElement[];
}

/**
 * The char -> token estimate behind the size backstop. jev's limit is a TOKEN budget, not a char
 * budget; the walker carries no tokenizer (and must not grow one — no new deps), so the backstop
 * converts source chars with the ~4-chars-per-token rule of thumb for code. An ESTIMATE, not a
 * measurement: dense symbol-heavy source reads as more tokens than the ratio predicts, which is why
 * the cap below keeps a margin under the measured ceiling instead of sitting on it.
 */
export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * The element size backstop, in TOKENS (the unit jev's budget counts): any element whose source
 * exceeds this is emitted with oversized: true and skipped by the classifier — ordinary code can
 * never crash the run with an oversized judgment request (design: composite body-size fix).
 * Chunking is rejected.
 *
 * Why 30k: measured against the live API (2026-10-05), jev accepts ~32k tokens and rejects ~48k
 * with 400 max_tokens_exceeded — and that budget is SHARED by the element source and the batched
 * questions (instructions + criteria). The default 11-rule batch costs ~2,080 estimated tokens
 * (7,879 chars, measured), so a 30k element lands just under the measured pass line: the 2k margin
 * between this cap and the ~32k ceiling IS the criteria reserve. It is deliberately NOT subtracted
 * per run — adding rules beyond the default set eats it. Two estimates stacked (chars/4 against a
 * measured ceiling): a margin, not a guarantee.
 */
export const MAX_ELEMENT_TOKENS = 30_000;

/**
 * The language-independent noun a grammar node abstracts into. Rules and the classifier route on
 * roles, never on grammar node names — adding a language is adding table entries, never touching
 * the walker.
 */
// Derived from the wire contract's element kinds minus the whole-unit kind — one vocabulary, no
// hand-copied mirror (the compiler rejects a kind the contract drops).
export type NodeRole = import("../types.ts").ElementRole;

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
 * The docstring of a python construct: the first statement of its body wrapping a string, or null
 * when there is none — other languages' definitions have no such statement, so the helper answers
 * null for them.
 */
function docstringOf(node: { namedChildren: SyntaxNode[] }): { text: string; span: Span } | null {
  const body = node.namedChildren.find((c) => c.type === "block");
  const first = body?.namedChildren[0];
  if (!first) return null;
  const wrapped = first.type === "expression_statement" ? first.namedChildren[0] : first;
  if (!wrapped || wrapped.type !== "string") return null;
  return { text: wrapped.text, span: spanOf(wrapped) };
}

function pythonOwnerName(node: { namedChildren: SyntaxNode[] }): string {
  return node.namedChildren.find((c) => c.type === "identifier")?.text ?? "";
}

/**
 * The declared name of a definition element, best-effort and render-only. Undefined when no single
 * name exists (multi-spec blocks, call composites, odd parses) — a missing name is honest, a wrong
 * one is not.
 */
function declaredName(type: string, node: { namedChildren: SyntaxNode[] }): string | undefined {
  const firstIdentifier = (n: { namedChildren: SyntaxNode[] }): string | undefined =>
    n.namedChildren.find((c) => c.type === "identifier")?.text;
  const childOfType = (n: { namedChildren: SyntaxNode[] }, nodeType: string) =>
    n.namedChildren.find((c) => c.type === nodeType);
  switch (type) {
    case "lexical_declaration":
    case "variable_declaration":
      return firstIdentifier(childOfType(node, "variable_declarator") ?? node);
    case "const_declaration":
    case "var_declaration": {
      const spec =
        childOfType(node, "const_spec") ??
        childOfType(node, "var_spec") ??
        childOfType(node, "var_spec_list");
      return spec !== undefined &&
        node.namedChildren.filter((c) => /_spec/.test(c.type)).length === 1
        ? firstIdentifier(spec)
        : undefined;
    }
    case "type_declaration": {
      const specs = node.namedChildren.filter((c) => c.type === "type_spec");
      return specs.length === 1 ? firstIdentifier(specs[0]!) : undefined;
    }
    case "call_expression":
      return undefined;
    default:
      return firstIdentifier(node);
  }
}

// tsx shares the typescript role table: the tsx grammar emits the same declaration node types,
// and JSX stays inside them (const x = () => <div/>) — a probe over real app views showed no
// jsx_* node type at the top level, so nothing extra to map.
const TSX: LanguageMapping = { ...TYPESCRIPT };

const LANGUAGES: Record<string, LanguageMapping> = {
  typescript: TYPESCRIPT,
  tsx: TSX,
  python: PYTHON,
  go: GO,
};

export function knownLanguages(): string[] {
  return Object.keys(LANGUAGES);
}

/**
 * Canonical extension per mapped grammar — the "parsing" side of the coverage note. A new grammar
 * adds its extension here in the same edit as its mapping entry.
 */
const GRAMMAR_EXTENSIONS: Record<string, string> = {
  typescript: "ts",
  tsx: "tsx",
  python: "py",
  go: "go",
};

export function grammarExtensions(): string[] {
  return Object.keys(LANGUAGES).map((id) => GRAMMAR_EXTENSIONS[id] ?? id);
}

const WASM_PATHS: Record<string, string> = {
  typescript: typescriptWasm,
  tsx: tsxWasm,
  python: pythonWasm,
  go: goWasm,
};

/** Parser instances are cached per language; web-tree-sitter itself initializes once. */
let initPromise: Promise<unknown> | null = null;
const parsers = new Map<string, Promise<Parser>>();

// The wasm engine initializes once for every grammar; parsers are cached per language.
function engineReady(): Promise<unknown> {
  initPromise ??= Parser.init({
    // Bun quirk: Emscripten resolves the .wasm relative to the JS shim unless redirected.
    locateFile: () => treeSitterWasm,
  });
  return initPromise;
}

async function createParser(language: string): Promise<Parser> {
  await engineReady();
  const grammar: LanguageType = await Language.load(
    new Uint8Array(await Bun.file(WASM_PATHS[language]!).arrayBuffer()),
  );
  return new Parser().setLanguage(grammar);
}

async function parserFor(language: string): Promise<Parser> {
  const cached = parsers.get(language);
  if (cached) return cached;
  if (!LANGUAGES[language] || !WASM_PATHS[language]) {
    throw new SetupError("INTERNAL", `no tree-sitter grammar mapped for language: ${language}`);
  }
  const created = createParser(language);
  parsers.set(language, created);
  return created;
}

interface RawElement {
  readonly label: string;
  readonly span: Span;
  readonly content: string;
  readonly nodeType: string;
  readonly role: NodeRole;
  readonly attachedComment?: readonly string[];
  readonly docstringOf?: DocstringOwner;
  readonly internalCommentCount: number;
  readonly parent?: string;
  /**
   * The element's source exceeds the size backstop (MAX_ELEMENT_TOKENS): never judged; named
   * in-band.
   */
  readonly oversized?: boolean;
}

function spanOf(node: {
  startIndex: number;
  endIndex: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
}): Span {
  return {
    start: { line: node.startPosition.row + 1, column: node.startPosition.column },
    end: { line: node.endPosition.row + 1, column: node.endPosition.column },
    startByte: node.startIndex,
    endByte: node.endIndex,
  };
}

export function isEmptyComment(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text);
}

function endPointOfContent(start: UnitPoint, content: string): UnitPoint {
  const contentLines = content.split("\n");
  const lastLine = contentLines[contentLines.length - 1]!;
  return {
    line: start.line + contentLines.length - 1,
    column: contentLines.length === 1 ? start.column + lastLine.length : lastLine.length,
  };
}

/**
 * The offset bounding a composite's source to its declaration: the first top-level '{'; when the
 * grammar has no braces, the first top-level ':' (inclusive). Neither: the full text. Depth is
 * tracked so a '{' inside a decorator call never ends the header early.
 */
function compositeHeaderEnd(text: string, nestedBraceEndsHeader: boolean): number {
  let depth = 0;
  let colon = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "{") {
      // A class body's brace sits at top level; a call composite's callback brace sits one
      // paren deep — either ends the header.
      if (depth === 0 || (nestedBraceEndsHeader && depth === 1)) return i;
      depth++;
    } else if (c === "}") {
      if (depth > 0) depth--;
    } else if (c === ":" && depth === 0 && colon === -1) colon = i;
  }
  return colon === -1 ? text.length : colon + 1;
}

/**
 * Mutable element collection shared by the descent and the top-level walk: definitions and comments
 * accumulate in document order; pending comments wait for the declaration they precede.
 */
interface ElementCollection {
  readonly mapping: LanguageMapping;
  /** The parse was flagged partial: recovered inner statements are fiction, never descended. */
  readonly degraded: boolean;
  readonly definitions: RawElement[];
  readonly comments: RawElement[];
  readonly importNodes: Array<{ nodeType: string; text: string; span: Span }>;
  /** Comments awaiting a definition to attach to, in document order. */
  pendingComments: Array<{ text: string; span: Span }>;
}

/** Node types recursed into but never emitted: descent glue between an element and its children. */
const DESCENT_CONTAINERS = new Set([
  "arguments",
  "statement_block",
  "class_body",
  "block",
  "arrow_function",
  "function_expression",
  "pair",
]);

/** Composites are judged AND descended into: emitted as a header, their body walked recursively. */
const COMPOSITES = new Set([
  "class_declaration",
  "abstract_class_declaration",
  "class_definition",
  "call_expression",
]);

// Syntax trees cannot cycle, but pathologically deep nesting should not walk unbounded;
// composites deeper than this stay header-only.
const MAX_DESCENT_DEPTH = 8;

function appendStandaloneComments(collection: ElementCollection, parent?: string): void {
  for (const pendingComment of collection.pendingComments)
    collection.comments.push({
      label: "c" + String(collection.comments.length),
      content: pendingComment.text,
      nodeType: "comment",
      role: "comment",
      span: pendingComment.span,
      internalCommentCount: 0,
      ...(parent !== undefined && { parent }),
    });
  collection.pendingComments = [];
}

/**
 * Emit one element for a definition node (composite or not). Content stays the complete node text,
 * except a composite, whose source is bounded to its declaration through the opening brace: real
 * corpora overflow the classifier's token budget on huge class bodies, and the body's facts travel
 * via the children the descent already yields — the parent's questions are about the declaration.
 * The attached doc comment travels outside the span, so it survives the bound.
 */
function appendDefinition(
  collection: ElementCollection,
  wrapperNode: SyntaxNode,
  declarationNode: SyntaxNode,
  type: string,
  role: NodeRole,
  parent: string | undefined,
  commentRun?: readonly string[],
): void {
  const label = "d" + String(collection.definitions.length);
  let { content, span } = definitionSource(wrapperNode, type);
  const declared = declaredName(type, declarationNode);
  const internalComments = collectInternalComments(declarationNode);
  collection.definitions.push({
    label,
    span,
    content,
    nodeType: type,
    role,
    ...(declared !== undefined && { name: declared }),
    ...(parent !== undefined && { parent }),
    // Internal comments stay IN PLACE (the body slice already carries them); the count is what
    // makes comment-target rules see (and cost a call for) a definition whose only comment is
    // internal - matchesTarget reads it, so the payload never duplicates a comment.
    ...(commentRun !== undefined && { attachedComment: commentRun }),
    internalCommentCount: internalComments.length,
  });
  const docstring = docstringOf(declarationNode);
  if (docstring) appendDocstringElement(collection, docstring, label, type, declarationNode);
}

/**
 * A composite's element source is bounded to its declaration through the opening brace; any other
 * definition keeps its complete node text and span.
 */
function definitionSource(wrapperNode: SyntaxNode, type: string): { content: string; span: Span } {
  const full = spanOf(wrapperNode);
  if (!COMPOSITES.has(type)) return { content: wrapperNode.text, span: full };
  const headerBound = compositeHeaderEnd(wrapperNode.text, type === "call_expression");
  if (headerBound >= wrapperNode.text.length) return { content: wrapperNode.text, span: full };
  const content = wrapperNode.text.slice(0, headerBound).trimEnd();
  return {
    content,
    span: {
      ...full,
      end: endPointOfContent(full.start, content),
      endByte: full.startByte + content.length,
    },
  };
}

/** The construct's docstring becomes its own classifiable comment element, owned by it. */
function appendDocstringElement(
  collection: ElementCollection,
  docstring: { text: string; span: Span },
  ownerLabel: string,
  type: string,
  declarationNode: SyntaxNode,
): void {
  collection.comments.push({
    label: "c" + String(collection.comments.length),
    content: docstring.text,
    nodeType: "string",
    role: "comment",
    span: docstring.span,
    internalCommentCount: 0,
    parent: ownerLabel,
    docstringOf: {
      kind: type === "class_definition" ? "class" : "function",
      name: pythonOwnerName(declarationNode),
    },
  });
}

/**
 * The pending comment run when it directly precedes the declaration (no blank line between);
 * otherwise undefined, leaving the run pending.
 */
function attachedCommentRun(
  collection: ElementCollection,
  wrapperNode: SyntaxNode,
): readonly string[] | undefined {
  const latestPending = collection.pendingComments.at(-1);
  const blankLineGap = latestPending
    ? wrapperNode.startPosition.row - (latestPending.span.end.line - 1)
    : Infinity;
  const attaches = collection.pendingComments.length > 0 && blankLineGap <= 1;
  if (!attaches) return undefined;
  const commentRun = collection.pendingComments.map((pendingComment) => pendingComment.text);
  collection.pendingComments = [];
  return commentRun;
}

function appendTopLevelElement(
  collection: ElementCollection,
  wrapperNode: SyntaxNode,
  declarationNode: SyntaxNode,
  type: string,
  role: NodeRole,
): void {
  const commentRun = attachedCommentRun(collection, wrapperNode);
  if (commentRun === undefined) appendStandaloneComments(collection);
  appendDefinition(collection, wrapperNode, declarationNode, type, role, undefined, commentRun);
  if (!COMPOSITES.has(type)) return;
  const label = "d" + String(collection.definitions.length - 1);
  if (collection.degraded) {
    // Recovered body: the element stays whole at its real node extent, never descended into.
    const lastDefinition = collection.definitions[collection.definitions.length - 1]!;
    if (lastDefinition.label === label) {
      collection.definitions[collection.definitions.length - 1] = {
        ...lastDefinition,
        content: declarationNode.text,
        span: spanOf(declarationNode),
      };
    }
    return;
  }
  walkNestedDefinitions(collection, declarationNode, label, 1);
}

function walkNestedDefinitions(
  collection: ElementCollection,
  branch: SyntaxNode,
  parent: string,
  depth: number,
): void {
  if (depth > MAX_DESCENT_DEPTH) return;
  for (const childNode of branch.namedChildren) {
    const { node: declarationNode, type } = unwrap(childNode, collection.mapping.wrapperTypes);
    const role = resolveRole(type, declarationNode, collection.mapping.roleTable);
    if (role !== undefined && role !== "comment" && role !== "import") {
      const label = "d" + String(collection.definitions.length);
      appendDefinition(collection, childNode, declarationNode, type, role, parent);
      if (COMPOSITES.has(type))
        walkNestedDefinitions(collection, declarationNode, label, depth + 1);
      continue;
    }
    if (DESCENT_CONTAINERS.has(type)) {
      walkNestedDefinitions(collection, declarationNode, parent, depth + 1);
    }
  }
}

/** The document walk: module docstring, standalone comments, imports, definitions, containers. */
function collectElements(
  collection: ElementCollection,
  branch: SyntaxNode,
  topLevel: boolean,
): void {
  const childNodes = branch.namedChildren;
  for (let i = 0; i < childNodes.length; i++) {
    const childNode = childNodes[i]!;
    // Unwrap wrappers but keep the node's span and text: content must stay complete ("export"
    // and all), spans must stay exact.
    const { node: declarationNode, type } = unwrap(childNode, collection.mapping.wrapperTypes);
    // Module docstring: the file's first statement wrapping a string, owned by the module.
    if (topLevel && i === 0 && type === "string") {
      collection.comments.push({
        label: "c" + String(collection.comments.length),
        content: declarationNode.text,
        nodeType: "string",
        role: "comment",
        span: spanOf(declarationNode),
        internalCommentCount: 0,
        docstringOf: { kind: "module", name: "" },
      });
      continue;
    }
    if (topLevel && collection.mapping.roleTable[type] === "comment") {
      if (!isEmptyComment(declarationNode.text))
        collection.pendingComments.push({
          text: declarationNode.text,
          span: spanOf(declarationNode),
        });
      continue;
    }
    if (collection.mapping.roleTable[type] === "import") {
      appendStandaloneComments(collection);
      collection.importNodes.push({
        nodeType: type,
        text: declarationNode.text,
        span: spanOf(declarationNode),
      });
      continue;
    }
    const role = resolveRole(type, declarationNode, collection.mapping.roleTable);
    if (role !== undefined && role !== "comment" && role !== "import") {
      appendTopLevelElement(collection, childNode, declarationNode, type, role);
      continue;
    }
    if (!topLevel && DESCENT_CONTAINERS.has(type)) {
      collectElements(collection, declarationNode, false);
      continue;
    }
    appendStandaloneComments(collection);
  }
}

function importGroupElement(
  importNodes: ReadonlyArray<{ nodeType: string; text: string; span: Span }>,
): WalkElement | undefined {
  if (importNodes.length === 0) return undefined;
  const first = importNodes[0]!;
  const last = importNodes.at(-1)!;
  return {
    label: "i0",
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

// Flagging, not truncating: the classifier refuses oversized requests, and a skipped judgment is
// honest where a truncated element would be judged on half its source.
function applySizeBackstop(elements: readonly RawElement[]): RawElement[] {
  return elements.map((element) =>
    charsToTokens(element.content.length) > MAX_ELEMENT_TOKENS
      ? { ...element, oversized: true }
      : element,
  );
}

/** Decompose one source string into its unit inventory; never throws for parse errors. */
export async function decompose(source: string, language: string): Promise<Inventory> {
  const mapping = LANGUAGES[language];
  if (!mapping) {
    throw new SetupError("INTERNAL", `no tree-sitter grammar mapped for language: ${language}`);
  }
  const parser = await parserFor(language);
  const tree = parser.parse(source);
  if (!tree) return { hasError: true, definitions: [], comments: [], imports: [] };

  const collection: ElementCollection = {
    mapping,
    degraded: tree.rootNode.hasError,
    definitions: [],
    comments: [],
    importNodes: [],
    pendingComments: [],
  };
  collectElements(collection, tree.rootNode, true);
  appendStandaloneComments(collection);

  const importElement = importGroupElement(collection.importNodes);
  // Labels are assigned at emit time (parent links reference them); sizing is order-preserving.
  return {
    hasError: tree.rootNode.hasError,
    definitions: applySizeBackstop(collection.definitions),
    comments: applySizeBackstop(collection.comments),
    imports: importElement ? applySizeBackstop([importElement]) : [],
  };
}

export function languageOf(path: string): string | null {
  if (/\.tsx$/.test(path)) return "tsx";
  if (/\.(m|c)?ts$/.test(path)) return "typescript";
  if (/\.py$/.test(path)) return "python";
  if (/\.go$/.test(path)) return "go";
  return null;
}

/**
 * The wire projection of one walked element: kind, span, label, parent, kind-specific name — never
 * the walked form's source content. One noun, two forms: the walk-time form carries the source; the
 * wire form is what a measurement references.
 */
export function projectElement(element: WalkElement): Element {
  const base = {
    span: element.span,
    label: element.label,
    ...(element.parent !== undefined && { parent: element.parent }),
  };
  switch (element.role) {
    case "comment":
      return {
        kind: "comment",
        ...base,
        ...(element.docstringOf !== undefined && { docstringOf: element.docstringOf }),
      };
    case "type":
      return { kind: "type", ...base, ...(element.name !== undefined && { name: element.name }) };
    case "binding":
      return {
        kind: "binding",
        ...base,
        ...(element.name !== undefined && { name: element.name }),
      };
    case "import":
      return { kind: "import", ...base };
    default:
      return {
        kind: "function",
        ...base,
        ...(element.name !== undefined && { name: element.name }),
      };
  }
}

export function fileElement(id: string, content: string): Element {
  const lines = content.split("\n").length;
  return {
    kind: "file",
    span: {
      start: { line: 1, column: 0 },
      end: { line: lines, column: 0 },
      startByte: 0,
      endByte: content.length,
    },
    label: id,
  };
}
