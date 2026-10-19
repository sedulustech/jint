/**
 * Tree-sitter mapping of a source file into a unit inventory: definitions, comments, and imports.
 * This module is the AST side of input: it parses, runs the grammar's compiled queries (query.ts),
 * and materializes the result - labels, comment attachment, the imports merge, the size backstop.
 * It holds no node-type names: the .scm assigns captures, the runtime sees only captures, and every
 * node no pattern captures passes through as nothing (unlisted nodes are legal and silent).
 *
 * Extraction is flag-independent: which files are acquired is decided elsewhere; the parse and the
 * inventory are identical always. The inventory is pure data - no linting, no classifier calls.
 *
 * Graceful degradation: a file whose parse is flagged as partial still yields whatever the queries
 * matched (tree-sitter recovers per-node, so partial structure survives). hasError carries the
 * flag; the yielded elements are exact for what parsed.
 */

import { InternalError, type DocstringOwner, type Element, type Span } from "../types.ts";
import {
  grammar,
  grammarExtensions,
  knownLanguages,
  languageOf,
  loadLanguage,
  parserFor,
  unclaimedExtension,
  EMBEDDED,
  type GrammarProvenance,
  type GrammarRegistry,
} from "./grammars.ts";
import {
  isEmptyComment,
  queryFor,
  resolveCandidates,
  runQuery,
  spanOf,
  type Candidate,
  type Capture,
  type QueryNode,
  compileQuery,
  scmCaptureDeclarations,
  scmCapturePolicy,
  scmEmittedNames,
  scmSelfNestingCaptures,
  type SuppressionOptions,
  type SuppressionShape,
  scmSelfNesting,
} from "./query.ts";
import { SHARED_ELEMENT_CAPTURES, sharedDefinitionDefault, sharedPolicyDefault } from "./shared.ts";

export { grammarExtensions, knownLanguages, languageOf, unclaimedExtension, EMBEDDED };
export type { GrammarRegistry } from "./grammars.ts";
export { isEmptyComment };
/** The wire captures: a docstring projects into the comment kind (it IS a comment element). */
export type WireCapture = Exclude<Capture, "docstring">;
export type { Capture };
export type { DocstringOwner } from "../types.ts";

/** An inventory element; slicing the source by its span bytes yields its content exactly. */
export interface InventoryElement {
  /** Stable positional label: "d0", "d1", "c0", "i0". */
  readonly label: string;
  readonly span: Span;
  readonly content: string;
  /** The grammar-local tree-sitter node type of the captured node (identity, not vocabulary). */
  readonly nodeType: string;
  /**
   * The jint-owned capture the .scm assigned to this node: what the element IS. Rules and the
   * classifier route on it; the frozen vocabulary lives in query.ts. @docstring candidates carry
   * the comment capture (a docstring IS a comment element; docstringOf says whose).
   */
  readonly capture: WireCapture;
  /** The grammar that extracted this element (the capture address resolves against it). */
  readonly grammar: string;
  /** The declared name, when a pattern bound @name (render-only; never an id). */
  readonly name?: string;
  /**
   * The comment run attached to this definition: leading comments ending strictly above its first
   * row, within the grammar's attach.gap (default: the directly preceding row). The run travels
   * OUTSIDE the span; comment-target rules judge the run through this field, so a definition whose
   * only comment is internal is still a comment unit via the count below.
   */
  readonly attachedComment?: readonly string[];
  /**
   * Docstring TEXTS this definition owns OUTSIDE its span: an owner=next docstring preceding it (a
   * leading `///`-style doc). The pair frame joins these into the measured documentation - without
   * them, a leading doc would count for the definition (docstringCount) yet never reach the
   * classifier. A BODY docstring (owner=enclosing, python's shape) sits inside the span and rides
   * content instead, so it never appears here - no text is measured twice.
   */
  readonly docstrings?: readonly string[];
  /** For a docstring element: what it documents; an orphan docstring never exists. */
  readonly docstringOf?: DocstringOwner;
  /** Non-empty comments fully inside this element's span (including nested elements' bodies). */
  readonly internalCommentCount: number;
  /**
   * Non-empty docstrings this definition owns (the pair split): ownership makes the definition a
   * comments match even with zero attached and zero internal comments, so a python function whose
   * only documentation is its docstring is still judged as documentation-with-code.
   */
  readonly docstringCount: number;
  /**
   * The enclosing element's label ("d3"), when this element sits inside one (a method inside its
   * class). Hierarchy travels with the element (design rules-context/02) - pairing reads it.
   */
  readonly parent?: string;
  /** The element's source exceeds the size backstop: never judged; named in-band. */
  readonly oversized?: boolean;
}

/** The structured unit inventory for one file. */
export interface Inventory {
  /** True when tree-sitter flagged the parse (partial syntax); the yielded elements are still exact. */
  readonly hasError: boolean;
  /** Which grammar served this parse (embedded asset or user wasm by path+version). */
  readonly provenance: GrammarProvenance;
  readonly definitions: InventoryElement[];
  readonly comments: InventoryElement[];
  /** Exactly one merged element when the file has imports; empty otherwise. */
  readonly imports: InventoryElement[];
}

/**
 * The char -> token estimate behind the size backstop. jev's limit is a TOKEN budget, not a char
 * budget; this side carries no tokenizer (and must not grow one - no new deps), so the backstop
 * converts source chars with the ~4-chars-per-token rule of thumb for code. An ESTIMATE, not a
 * measurement: dense symbol-heavy source reads as more tokens than the ratio predicts, which is why
 * the cap below keeps a margin under the measured ceiling instead of sitting on it.
 */
export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * The element size backstop, in TOKENS (the unit jev's budget counts): any element whose source
 * exceeds this is emitted with oversized: true and skipped by the classifier - ordinary code can
 * never crash the run with an oversized judgment request. Chunking is rejected.
 *
 * Why 30k: measured against the live API (2026-10-05), jev accepts ~32k tokens and rejects ~48k
 * with 400 max_tokens_exceeded - and that budget is SHARED by the element source and the batched
 * questions (instructions + criteria). The default 11-rule batch costs ~2,080 estimated tokens
 * (7,879 chars, measured), so a 30k element lands just under the measured pass line: the 2k margin
 * between this cap and the ~32k ceiling IS the criteria reserve. It is deliberately NOT subtracted
 * per run - adding rules beyond the default set eats it. Two estimates stacked (chars/4 against a
 * measured ceiling): a margin, not a guarantee.
 */
export const MAX_ELEMENT_TOKENS = 30_000;

// Flagging, not truncating: the classifier refuses oversized requests, and a skipped judgment is
// honest where a truncated element would be judged on half its source.
function applySizeBackstop<T extends { content: string }>(elements: readonly T[]): T[] {
  return elements.map((element) =>
    charsToTokens(element.content.length) > MAX_ELEMENT_TOKENS
      ? { ...element, oversized: true }
      : element,
  );
}

/**
 * Is a captured candidate an ELEMENT? The OWNING grammar's `capture.<name>.definition` directives
 * resolve it (scmCaptureDeclarations) over the tier-1 shared defaults (shared.ts - the lingua
 * franca's shape, the only capture-keyed behavior the engine holds): a shared definition capture is
 * an element unless its grammar overrides to false; an AUTONOMOUS capture must declare true or it
 * is inert (captured, never materialized - the .scm said so, not an engine table).
 */
/**
 * One grammar's suppression facts: per-capture shapes (directive overrides over the tier-1 shared
 * defaults; an undeclared autonomous capture hides and absorbs nothing) and the nesting flags
 * (per-capture `capture.<name>.selfNesting`, or the file-wide bare `selfNesting` - the grammar-wide
 * form every capture of the grammar inherits).
 */
/**
 * The captures this grammar's walk yields candidates for: the shared lingua franca plus its own
 * declared autonomous captures.
 */
function resolveAddressable(scm: string): ReadonlySet<string> {
  const declared = scmCaptureDeclarations(scm);
  const addressable = new Set<string>(SHARED_ELEMENT_CAPTURES);
  for (const capture of declared.definitions) addressable.add(capture);
  for (const capture of declared.inert) addressable.add(capture);
  return addressable;
}

function resolveSuppression(scm: string): SuppressionOptions {
  const declared = scmCapturePolicy(scm);
  const shapes = new Map<string, SuppressionShape>();
  for (const capture of scmEmittedNames(scm)) {
    shapes.set(capture, { ...sharedPolicyDefault(capture), ...declared.get(capture) });
  }
  const selfNestingCaptures = new Set<string>(scmSelfNestingCaptures(scm));
  if (scmSelfNesting(scm))
    for (const capture of scmEmittedNames(scm)) selfNestingCaptures.add(capture);
  return { shapes, selfNestingCaptures };
}

function resolveDefinitionCaptures(scm: string): ReadonlySet<string> {
  const declared = scmCaptureDeclarations(scm);
  const resolved = new Set<string>();
  for (const capture of scmEmittedNames(scm)) {
    if (declared.inert.has(capture)) continue;
    if (declared.definitions.has(capture) || sharedDefinitionDefault(capture))
      resolved.add(capture);
  }
  return resolved;
}

/**
 * Materialize candidates into the inventory: comment attachment (leading runs join the directly
 * following definition), internal-comment counting, the imports merge, labels, parent links.
 *
 * THE DIRECTIVE READS: grouping knobs a grammar sets in its .scm arrive here on the candidates
 * (Candidate.properties, the engine's own #set! parse). Every read carries its code default for the
 * absent case - a grammar with no directives gets the measured-default grouping (gap 1, enclosing
 * docstring owner, contiguous import runs), and the directive only declares a fact the pattern can
 * see about its own captures.
 */
function materialize(
  candidates: readonly Candidate[],
  grammarId: string,
  source: string,
  definitionCaptures: ReadonlySet<string>,
): {
  definitions: InventoryElement[];
  comments: InventoryElement[];
  imports: InventoryElement[];
} {
  const definitions = candidates.filter((c) => definitionCaptures.has(c.capture));
  const comments = candidates.filter((c) => c.capture === "comment");
  const imports = candidates.filter((c) => c.capture === "import");
  const orderedDefinitions = [...definitions].sort((a, b) => a.node.startIndex - b.node.startIndex);

  // Docstrings: the grammar's declared docstring convention (python's string-in-block). They
  // are owned comment elements - docstring ownership answers who they document (the innermost
  // containing definition, or the module) - never internal counts.
  const isDocstring = (c: Candidate): boolean => c.capture === "docstring";
  // OWNER LINK (the comment-target pair split): a comment element is DOCUMENTATION when a
  // definition owns it - its text is that definition's attached run, or it sits inside the
  // definition's body (an internal note). Owned comments travel in the definition's pair
  // frame; unowned ones are reported as loose comments. The link reuses docstring ownership,
  // which answers "who this comment documents".
  const ownerOf = (comment: Candidate): DocstringOwner | undefined => {
    // DOCSTRING OWNER DIRECTION (the .scm's docstring.owner directive): a grammar whose docstring
    // convention PRECEDES what it documents (a doc attribute above a definition) declares
    // "next" and the owner is the first definition after the docstring; the default
    // "enclosing" is the innermost containing definition (python's string-in-block).
    if (comment.properties?.["docstring.owner"] === "next") {
      const next = orderedDefinitions.find((d) => d.node.startIndex >= comment.node.endIndex);
      return next === undefined
        ? { kind: "module", name: "" }
        : {
            kind: next.capture as DocstringOwner["kind"],
            name: next.name ?? "",
          };
    }
    for (const [definition, run] of attachedRuns) {
      // IDENTITY, not text: the run holds the same candidate objects the comment elements hold -
      // an equal-text comment elsewhere in the file (two "// namespace" closers, a copied
      // docblock) can never steal ownership through a text match (process.cc L466/L595).
      if (run.includes(comment)) {
        return {
          // LOSSLESS: the owner kind IS the owner capture - the same cast the innermost branch
          // makes; the old type->class/everything-else->function map was a stale two-kind
          // collapse the contract's six-kind DocstringOwner had already outgrown.
          kind: definition.capture as DocstringOwner["kind"],
          name: definition.name ?? "",
        };
      }
    }
    let innermost: Candidate | undefined;
    for (const definition of definitions) {
      if (!containsSpan(definition, comment)) continue;
      if (
        innermost === undefined ||
        definition.node.endIndex - definition.node.startIndex <=
          innermost.node.endIndex - innermost.node.startIndex
      ) {
        innermost = definition;
      }
    }
    if (innermost === undefined)
      return isDocstring(comment) ? { kind: "module", name: "" } : undefined;
    return {
      // LOSSLESS: the owner kind IS the owner capture (the old class/function collapse lost type vs class)
      // a definition capture only (ownerOf scans the grammar's resolved definition set); the lane captures cannot own
      kind: innermost.capture as DocstringOwner["kind"],
      name: innermost.name ?? "",
    };
  };

  // Internal comments: every non-empty comment fully inside a definition counts for EACH
  // containing definition (a method body's comment counts for the method and its class) - the
  // count is what lets comment-target rules see a definition whose only comment is internal.
  const internalCounts = new Map<Candidate, number>();
  for (const comment of comments) {
    if (isDocstring(comment)) continue;
    if (isEmptyComment(comment.node.text)) continue;
    for (const definition of definitions) {
      if (
        definition.node.startIndex <= comment.node.startIndex &&
        definition.node.endIndex >= comment.node.endIndex
      ) {
        internalCounts.set(definition, (internalCounts.get(definition) ?? 0) + 1);
      }
    }
  }

  // Comment attachment, document order over the candidates NOT inside any definition: comments
  // accumulate as a pending run; a following definition takes the run when the run ends strictly
  // above the definition's first row within the grammar's attach.gap (default: the directly
  // preceding row). Anything else flushes the run as standalone comment elements.
  //
  // TRAILING SIDE: a comment that starts on a row where the previous candidate ENDS is a note
  // on that candidate (interface.c: `static size_t qjs_mem_limit = 0; /* 0 = unlimited */` - the
  // note rode one row down onto the NEXT binding under a row-only gap), so it never joins a
  // pending run. LEADING SIDE: the run's last comment must end strictly ABOVE the definition's
  // first row - a comment sharing the definition's own row is beside it, not above it.
  // Column-0 leak: some grammars' nodes (C includes) absorb the trailing newline and end at
  // column 0 of the NEXT row - that row is not really claimed (nothing precedes col 0), so the
  // effective end row steps back one when the span closes at column 0.
  const effectiveEndRow = (node: QueryNode): number =>
    node.endPosition.column === 0 && node.endPosition.row > node.startPosition.row
      ? node.endPosition.row - 1
      : node.endPosition.row;
  const topLevel = candidates.filter(
    (c) => !definitions.some((d) => d !== c && containsSpan(d, c)),
  );
  const pending: Candidate[] = [];
  const attachedRuns = new Map<Candidate, readonly Candidate[]>();
  const standalone: Candidate[] = [];
  let lastClaimantRow = -1;
  for (const candidate of topLevel) {
    const startRow = candidate.node.startPosition.row;
    if (candidate.capture === "comment") {
      if (startRow <= lastClaimantRow) {
        standalone.push(...pending, candidate);
        pending.length = 0;
        continue;
      }
      pending.push(candidate);
      continue;
    }
    lastClaimantRow = effectiveEndRow(candidate.node);
    if (candidate.capture === "import") {
      standalone.push(...pending);
      pending.length = 0;
      continue;
    }
    const latest = pending.at(-1);
    // attach.gap (rows the run's end may sit above the definition; default 1 - the directly
    // preceding row; 0 declares the capture takes no attached run)
    const declared = candidate.properties?.["attach.gap"] ?? undefined;
    const allowed = declared === undefined ? 1 : Number.parseInt(declared, 10);
    const latestEnd = latest === undefined ? -1 : effectiveEndRow(latest.node);
    const gap = latest === undefined ? Infinity : startRow - latestEnd;
    if (latest !== undefined && gap <= allowed && latestEnd < startRow) {
      // a copy: `pending` is reused (cleared) after every claim; the run must not alias it
      attachedRuns.set(candidate, [...pending]);
    } else {
      standalone.push(...pending);
    }
    pending.length = 0;
  }
  standalone.push(...pending);

  // Comments bucket (design: the three-dimension comment model): EVERY non-empty comment text
  // lands in the bucket - standalone, attached to a definition, internal to one, or a docstring
  // - so a comment is always judged as a comment. Attachment is extra structure on top
  // (the attached run and internal counts live on the definition, ownership on the comment),
  // never a replacement for presence.
  // Docstring ownership (the pair split): the count per definition that contains one, so the
  // frame knows it carries documentation even when no comment attaches and none is internal.
  // A "next" docstring counts for the definition AFTER it instead (its declared owner) - and its
  // TEXT rides that definition's frame (docstrings): a leading doc sits outside every span, so
  // the count alone would gate the comments target while the classifier never saw the words.
  // An enclosing-owned docstring (python's body shape) counts only - its text is inside the
  // definition's span already, and content carries it.
  const docstringCounts = new Map<Candidate, number>();
  const docstringTexts = new Map<Candidate, readonly string[]>();
  for (const docstring of candidates) {
    if (!isDocstring(docstring) || isEmptyComment(docstring.node.text)) continue;
    if (docstring.properties?.["docstring.owner"] === "next") {
      const next = orderedDefinitions.find((d) => d.node.startIndex >= docstring.node.endIndex);
      if (next !== undefined) {
        docstringCounts.set(next, (docstringCounts.get(next) ?? 0) + 1);
        const owned = [...(docstringTexts.get(next) ?? []), docstring.node.text];
        docstringTexts.set(next, owned);
      }
      continue;
    }
    for (const definition of definitions) {
      if (containsSpan(definition, docstring)) {
        docstringCounts.set(definition, (docstringCounts.get(definition) ?? 0) + 1);
      }
    }
  }

  // Comments bucket (the comment-target pair split): every non-empty comment text still lands
  // as a comment element, but target resolution routes it - owned comments travel in their
  // definition's pair frame (the attached run, internal and docstring counts), and only
  // unowned ones address rules through the element itself (loose comments). A module docstring
  // has no definition frame, so its element speaks for it in the comments group.
  const commentTexts = [...comments, ...docstringsOf(candidates, isDocstring)].filter(
    (c) => !isEmptyComment(c.node.text),
  );
  const commentElements = [...new Set(commentTexts)].sort(
    (a, b) => a.node.startIndex - b.node.startIndex,
  );
  const labels = new Map<Candidate, string>();
  definitions.forEach((d, i) => labels.set(d, "d" + String(i)));
  commentElements.forEach((c, i) => labels.set(c, "c" + String(i)));

  // Parents: the innermost OTHER definition containing this one.
  const parentOf = (candidate: Candidate): string | undefined => {
    let innermost: Candidate | undefined;
    for (const definition of definitions) {
      if (definition === candidate) continue;
      if (!containsSpan(definition, candidate)) continue;
      if (
        innermost === undefined ||
        definition.node.endIndex - definition.node.startIndex <=
          innermost.node.endIndex - innermost.node.startIndex
      ) {
        innermost = definition;
      }
    }
    return innermost === undefined ? undefined : labels.get(innermost);
  };

  const walkDefinitions: InventoryElement[] = definitions.map((d) => ({
    label: labels.get(d)!,
    span: spanOf(d.node),
    content: d.node.text,
    nodeType: d.node.type,
    capture: d.capture as WireCapture,
    grammar: grammarId,
    name: d.name,
    attachedComment: attachedRuns.get(d)?.map((c) => c.node.text),
    docstrings: docstringTexts.get(d),
    internalCommentCount: internalCounts.get(d) ?? 0,
    docstringCount: docstringCounts.get(d) ?? 0,
    parent: parentOf(d),
  }));
  const walkComments: InventoryElement[] = commentElements.map((c) => ({
    label: labels.get(c)!,
    span: spanOf(c.node),
    content: c.node.text,
    nodeType: c.node.type,
    capture: "comment" as const,
    grammar: grammarId,
    internalCommentCount: 0,
    docstringCount: 0,
    parent: parentOf(c),
    docstringOf: ownerOf(c),
  }));

  // The imports merge, per CONTIGUOUS RUN: adjacent import nodes (nothing but whitespace
  // between them, no other candidate intervening) merge into one element; a blank row or any
  // non-import candidate ends the element - a scattered import (a typescript re-export after
  // code, a C #include mid-file) never drags intervening source into a merged span. The run's
  // content is its span slice, so "slice the span, get the content" holds by construction.
  // import.merge "contiguous" declares this style in the .scm; it is the engine default too.
  const orderedImports = [...imports].sort((a, b) => a.node.startIndex - b.node.startIndex);
  // the DIRECTIVE IS READ: import.merge "none" on a candidate keeps it out of any run (its own
  // element); absent defaults to "contiguous" - the declared value can flip the behavior, and
  // this read is what makes the declaration do work
  const mergesWithPrevious = (candidate: (typeof orderedImports)[number]): boolean =>
    candidate.properties?.["import.merge"] !== "none";
  const runs: (typeof orderedImports)[] = [];
  for (const candidate of orderedImports) {
    const previous = runs.at(-1)?.at(-1);
    const splits =
      previous === undefined ||
      // a blank row between: the text between the two nodes carries two newlines (row-only gaps
      // misread on grammars whose include nodes absorb neighboring newlines into their spans)
      (source.slice(previous.node.endIndex, candidate.node.startIndex).match(/\n/g) ?? []).length >
        1 ||
      candidates.some(
        (other) =>
          other.capture !== "import" &&
          other.node.startIndex < candidate.node.startIndex &&
          other.node.endIndex > previous.node.endIndex,
      );
    if (splits || !mergesWithPrevious(candidate)) runs.push([candidate]);
    else runs.at(-1)!.push(candidate);
  }
  const walkImports: InventoryElement[] = runs.map((run, index) => {
    const first = run[0]!;
    const last = run.at(-1)!;
    return {
      label: "i" + String(index),
      span: {
        start: spanOf(first.node).start,
        end: spanOf(last.node).end,
        startByte: first.node.startIndex,
        endByte: last.node.endIndex,
      },
      content: source.slice(first.node.startIndex, last.node.endIndex),
      nodeType: first.node.type,
      capture: "import" as const,
      grammar: grammarId,
      internalCommentCount: 0,
      docstringCount: 0,
    };
  });

  return { definitions: walkDefinitions, comments: walkComments, imports: walkImports };
}

/** The @docstring candidates, document order (empty texts are not docstrings). */
function docstringsOf(
  candidates: readonly Candidate[],
  isDocstring: (c: Candidate) => boolean,
): Candidate[] {
  return candidates
    .filter((c) => isDocstring(c) && !isEmptyComment(c.node.text))
    .sort((a, b) => a.node.startIndex - b.node.startIndex);
}

function containsSpan(outer: Candidate, inner: Candidate): boolean {
  return (
    outer.node.startIndex <= inner.node.startIndex && outer.node.endIndex >= inner.node.endIndex
  );
}

/** Decompose one source string into its unit inventory; never throws for parse errors. */
export async function decompose(
  source: string,
  language: string,
  options: { readonly queries?: string; readonly registry?: GrammarRegistry } = {},
): Promise<Inventory> {
  // the registry the walk reads: handed by the scope that owns the run/call (embedded base when a
  // direct caller names none)
  const registry = options.registry ?? EMBEDDED;
  const entry = grammar(registry, language);
  const [parser, lang] = await Promise.all([parserFor(entry), loadLanguage(entry)]);
  // an explicit .scm override (capture() with a query file) REPLACES the registered one for
  // extraction and goes through the SAME loud compile checks, uncached (one call, one compile).
  // The one entry that may carry an empty-queries marker (registered alongside an override) can
  // never reach here override-less: it exists only inside the call's own registry value.
  const scm = options.queries ?? entry.queries;
  const query = options.queries
    ? await compileQuery(language, scm, lang)
    : await queryFor(entry, scm, lang);
  const tree = parser.parse(source);
  // a null tree is an engine failure, not a parse error (those surface via hasError):
  // an empty inventory would report success on an unmeasured file
  if (!tree) throw new InternalError(`parser returned no tree for ${language}`);

  // SHAPE DIRECTIVES: read syntactically from the .scm through the SHARED reader (strings blanked,
  // then comments cut - a trailing comment or a predicate string cannot fake a directive). The
  // grammar's own facts - definitions, suppression shapes, nesting - resolve HERE from its
  // directives over the tier-1 shared defaults; the engine holds no per-capture table.
  const candidates = resolveCandidates(
    runQuery(query, tree.rootNode, resolveAddressable(scm)),
    resolveSuppression(scm),
  );
  const definitionCaptures = resolveDefinitionCaptures(scm);
  const { definitions, comments, imports } = materialize(
    candidates,
    language,
    source,
    definitionCaptures,
  );
  return {
    hasError: tree.rootNode.hasError,
    provenance: entry.provenance,
    definitions: applySizeBackstop(definitions),
    comments: applySizeBackstop(comments),
    imports: applySizeBackstop(imports),
  };
}

/**
 * The wire projection of one walked element: kind, span, label, parent, kind-specific name - never
 * the walked form's source content. One capture, two forms: the walk-time form carries the source;
 * the wire form is what a measurement references.
 */
/** The projection view: the base fields every Element shares (span, label, parent). */
interface ProjectionBase {
  readonly span: Span;
  readonly label: string;
  readonly parent?: string;
}

// THE PROJECTION: one entry per capture, typed exhaustively over Capture - adding a capture
// without a projection is a compile error here, never a runtime surprise mid-walk.
const PROJECTION: {
  readonly [shared: string]: (element: InventoryElement, base: ProjectionBase) => Element;
} = {
  comment: (e, base) => ({ kind: "comment", ...base, docstringOf: e.docstringOf }),
  docstring: (e, base) => ({ kind: "comment", ...base, docstringOf: e.docstringOf }),
  type: (e, base) => ({ kind: "type", ...base, name: e.name }),
  binding: (e, base) => ({ kind: "binding", ...base, name: e.name }),
  import: (_e, base) => ({ kind: "import", ...base }),
  function: (e, base) => ({ kind: "function", ...base, name: e.name }),
  method: (e, base) => ({ kind: "method", ...base, name: e.name }),
  class: (e, base) => ({ kind: "class", ...base, name: e.name }),
};

/**
 * Project one inventory element to the wire. SHARED captures carry their typed shapes; an
 * AUTONOMOUS capture rides the generic element shape - its kind is its capture name, its name rides
 * when a pattern binds @name (markdown's section names from its heading text). No engine list
 * enumerates the autonomous names; the .scm that declares the capture defines its wire face.
 */
export function projectElement(element: InventoryElement): Element {
  const base: ProjectionBase = {
    span: element.span,
    label: element.label,
    parent: element.parent,
  };
  const project = PROJECTION[element.capture];
  if (project !== undefined) return project(element, base);
  if (element.name === undefined) return { kind: element.capture, ...base };
  return { kind: element.capture, ...base, name: element.name };
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
