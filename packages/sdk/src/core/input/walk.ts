/**
 * Tree-sitter mapping of a source file into a unit inventory: definitions, comments, and imports.
 * The walker is infrastructure: it parses, runs the grammar's compiled queries (query.ts), and
 * materializes the result - labels, comment attachment, the imports merge, the size backstop. It
 * holds no node-type names: the .scm assigns captures, the runtime sees only captures, and every
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
  type GrammarProvenance,
} from "./grammars.ts";
import {
  isEmptyComment,
  queryFor,
  resolveCandidates,
  runQuery,
  spanOf,
  type Candidate,
  type Capture,
} from "./query.ts";

export { grammarExtensions, knownLanguages, languageOf };
export { isEmptyComment };
/** The wire captures: @docstring projects into the comment kind (it IS a comment element). */
export type WireCapture = Exclude<Capture, "docstring">;
export type { Capture };
export type { DocstringOwner } from "../types.ts";

/** An inventory element; slicing the source by its span bytes yields its content exactly. */
export interface WalkElement {
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
  /** The declared name, when a pattern bound @name (render-only; never an id). */
  readonly name?: string;
  /**
   * The comment run attached to this definition: leading comments directly preceding it (no
   * blank-line gap). The run travels OUTSIDE the span; comment-target rules judge the run through
   * this field, so a definition whose only comment is internal is still a comment unit via the
   * count below.
   */
  readonly attachedComment?: readonly string[];
  /** For a docstring element: what it documents; an orphan docstring never exists. */
  readonly docstringOf?: DocstringOwner;
  /** Non-empty comments fully inside this element's span (including nested elements' bodies). */
  readonly internalCommentCount: number;
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
  readonly definitions: WalkElement[];
  readonly comments: WalkElement[];
  /** Exactly one merged element when the file has imports; empty otherwise. */
  readonly imports: WalkElement[];
}

/**
 * The char -> token estimate behind the size backstop. jev's limit is a TOKEN budget, not a char
 * budget; the walker carries no tokenizer (and must not grow one - no new deps), so the backstop
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

const DEFINITION_CAPTURES: ReadonlySet<Capture> = new Set(["function", "type", "binding"]);

/**
 * Materialize candidates into the inventory: comment attachment (leading runs join the directly
 * following definition), internal-comment counting, the imports merge, labels, parent links.
 */
function materialize(candidates: readonly Candidate[]): {
  definitions: WalkElement[];
  comments: WalkElement[];
  imports: WalkElement[];
} {
  const definitions = candidates.filter((c) => DEFINITION_CAPTURES.has(c.capture));
  const comments = candidates.filter((c) => c.capture === "comment");
  const imports = candidates.filter((c) => c.capture === "import");

  // Docstrings: the grammar's @docstring captures (its declared convention, python's
  // string-in-block). They are owned comment elements - docstringOf answers who they document
  // (the innermost containing definition, or the module) - never internal counts.
  const isDocstring = (c: Candidate): boolean => c.capture === "docstring";
  const docstringOf = (candidate: Candidate): DocstringOwner => {
    let innermost: Candidate | undefined;
    for (const definition of definitions) {
      if (!containsSpan(definition, candidate)) continue;
      if (
        innermost === undefined ||
        definition.node.endIndex - definition.node.startIndex <=
          innermost.node.endIndex - innermost.node.startIndex
      ) {
        innermost = definition;
      }
    }
    if (innermost === undefined) return { kind: "module", name: "" };
    return {
      kind: innermost.capture === "type" ? "class" : "function",
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
  // accumulate as a pending run; a directly following definition (no blank line) takes the run,
  // anything else flushes it as standalone comment elements.
  const topLevel = candidates.filter(
    (c) => !definitions.some((d) => d !== c && containsSpan(d, c)),
  );
  const pending: Candidate[] = [];
  const attached = new Map<Candidate, readonly string[]>();
  const standalone: Candidate[] = [];
  for (const candidate of topLevel) {
    if (candidate.capture === "comment") {
      pending.push(candidate);
      continue;
    }
    if (candidate.capture === "import") {
      standalone.push(...pending);
      pending.length = 0;
      continue;
    }
    const latest = pending.at(-1);
    const gap =
      latest === undefined
        ? Infinity
        : candidate.node.startPosition.row - latest.node.endPosition.row;
    if (latest !== undefined && gap <= 1) {
      attached.set(
        candidate,
        pending.map((p) => p.node.text),
      );
    } else {
      standalone.push(...pending);
    }
    pending.length = 0;
  }
  standalone.push(...pending);

  // Labels follow document order: definitions d0.., comments c0.. (docstrings and standalone
  // comments share the c-lane, ordered by document position), imports i0.
  const docstringElements = docstringsOf(candidates, isDocstring);
  // docstrings are owned, never standalone: the standalone lane drops them (a module docstring
  // matches both the .scm's docstring pattern and the top-level comment walk)
  const commentElements = [...new Set([...standalone, ...docstringElements])].sort(
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

  const walkDefinitions: WalkElement[] = definitions.map((d) => ({
    label: labels.get(d)!,
    span: spanOf(d.node),
    content: d.node.text,
    nodeType: d.node.type,
    capture: d.capture as WireCapture,
    name: d.name,
    attachedComment: attached.get(d),
    internalCommentCount: internalCounts.get(d) ?? 0,
    parent: parentOf(d),
  }));
  const walkComments: WalkElement[] = commentElements.map((c) => ({
    label: labels.get(c)!,
    span: spanOf(c.node),
    content: c.node.text,
    nodeType: c.node.type,
    capture: "comment" as const,
    internalCommentCount: 0,
    parent: parentOf(c),
    docstringOf: isDocstring(c) ? docstringOf(c) : undefined,
  }));

  // The imports element spans the whole run (first to last import node); one merged element
  // keeps the import block a single judgment unit.
  const walkImports: WalkElement[] =
    imports.length > 0
      ? [
          {
            label: "i0",
            span: {
              start: spanOf(imports[0]!.node).start,
              end: spanOf(imports.at(-1)!.node).end,
              startByte: imports[0]!.node.startIndex,
              endByte: imports.at(-1)!.node.endIndex,
            },
            content: imports.map((i) => i.node.text).join("\n"),
            nodeType: imports[0]!.node.type,
            capture: "import" as const,
            internalCommentCount: 0,
          },
        ]
      : [];

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
export async function decompose(source: string, language: string): Promise<Inventory> {
  const entry = grammar(language);
  const [parser, lang] = await Promise.all([parserFor(language), loadLanguage(language)]);
  const query = await queryFor(language, entry.queries, lang);
  const tree = parser.parse(source);
  // a null tree is an engine failure, not a parse error (those surface via hasError):
  // an empty inventory would report success on an unmeasured file
  if (!tree) throw new InternalError(`parser returned no tree for ${language}`);

  const candidates = resolveCandidates(runQuery(query, tree.rootNode), {
    selfNesting: entry.sameCaptureNesting === true,
  });
  const { definitions, comments, imports } = materialize(candidates);
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
export function projectElement(element: WalkElement): Element {
  const base = {
    span: element.span,
    label: element.label,
    parent: element.parent,
  };
  switch (element.capture) {
    case "comment":
      return { kind: "comment", ...base, docstringOf: element.docstringOf };
    case "type":
      return { kind: "type", ...base, name: element.name };
    case "binding":
      return { kind: "binding", ...base, name: element.name };
    case "import":
      return { kind: "import", ...base };
    case "function":
      return { kind: "function", ...base, name: element.name };
    default: {
      // Unreachable with the frozen vocabulary; a loud internal error, never a silent projection.
      throw new InternalError(
        "no wire projection for capture: " + String((element as { capture: string }).capture),
      );
    }
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
