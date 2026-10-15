/**
 * The query runtime: a grammar's queries.scm IS the mapping. The .scm assigns jint-owned captures
 * to matched nodes; this file turns matches into candidate elements and resolves the overlap
 * policy. The walker (walk.ts) holds no node-type names; the runtime sees only captures.
 *
 * Capture vocabulary (frozen for v1; a capture name is an identity, never a label):
 *
 * @function @type @binding @comment @import - what one element IS (singular)
 * @name - the element's declared name (render-only; never an identity)
 *
 * Policy shipped with the typescript port (design: grammar-loading, evidence-first):
 *   - span = captured node. Absorb is pattern authoring: a wrapper that belongs to the element
 *     (export_statement, decorated_definition) is captured by the wrapper pattern.
 *   - pattern order is priority: two patterns assigning different captures to the same node
 *     resolve to the earlier pattern (the callable-initializer refinement depends on it).
 *   - same-capture nesting is suppressed, keeping the outer element (an exported declaration's
 *     bare-pattern match dies under the wrapper match); different-capture overlap is legal
 *     (a method inside its class).
 *   - per-noun descent defaults: a @type element's interior surfaces (a method is an element of
 *     its own); a @function or @binding interior is OPAQUE - captures inside a function body
 *     (local bindings, nested functions) are implementation, never elements. This is the query
 *     shape of the old walker's composite-descent limit, settled by the typescript parity run.
 *   - unlisted nodes passthrough: a node no pattern captures yields nothing and blocks nothing.
 *
 * Static analysis of the .scm over-approximates under predicates (a captured node may be filtered
 * by #eq?/#match? at match time) - capture-vocabulary validation is therefore a loud check on the
 * NAMES a query uses, never on the nodes they will bind.
 */

import { Query, type QueryMatch } from "web-tree-sitter";
import { SetupError, type Span } from "../types.ts";

/** The element captures, frozen for v1. A query capturing anything else fails at load. */
export const ELEMENT_CAPTURES = ["function", "type", "binding", "comment", "import"] as const;
export type Capture = (typeof ELEMENT_CAPTURES)[number];

/** Renders a definition's name; present only when a pattern binds it. */
const NAME_CAPTURE = "name";
const KNOWN_CAPTURES: ReadonlySet<string> = new Set([...ELEMENT_CAPTURES, NAME_CAPTURE]);

/** Compile one grammar's .scm; cached per language (queries are immutable per process). */
const compiled = new Map<string, Promise<Query>>();

export function queryFor(
  language: string,
  scm: string,
  lang: import("web-tree-sitter").Language,
): Promise<Query> {
  let cached = compiled.get(language);
  if (cached) return cached;
  const created = (async () => {
    let query: Query;
    try {
      query = new Query(lang, scm);
    } catch (e) {
      throw new SetupError(
        "CONFIG_INVALID",
        "query compilation failed for " +
          language +
          ": " +
          (e instanceof Error ? e.message : String(e)),
      );
    }
    const unknown = query.captureNames.filter((name) => !KNOWN_CAPTURES.has(name));
    if (unknown.length > 0) {
      throw new SetupError(
        "CONFIG_INVALID",
        "query for " +
          language +
          " captures outside the vocabulary: " +
          unknown.join(", ") +
          " (the vocabulary is " +
          [...KNOWN_CAPTURES].join(", ") +
          ")",
      );
    }
    return query;
  })();
  compiled.set(language, created);
  return created;
}

/** Test seam: drop compiled queries (grammar re-registration replaces .scm content). */
export function resetQueriesForTest(): void {
  compiled.clear();
}

/** The shape of a syntax node the runtime reads (structural: tests can feed plain objects). */
export interface QueryNode {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly text: string;
  readonly type: string;
}

/** The tree root the query runs over: a web-tree-sitter Node structurally. */
export type QueryMatchSource = Parameters<Query["matches"]>[0];

export interface Candidate {
  /** The .scm pattern that produced this candidate: pattern order is priority. */
  readonly pattern: number;
  readonly capture: Capture;
  /** The captured node IS the element: span and content come from it (span = captured node). */
  readonly node: QueryNode;
  readonly name?: string;
}

/** The element capture of one match (the first captured noun), or null for name-only patterns. */
function elementCaptureOf(match: QueryMatch): Capture | null {
  for (const capture of match.captures) {
    if ((ELEMENT_CAPTURES as readonly string[]).includes(capture.name)) {
      return capture.name as Capture;
    }
  }
  return null;
}

/** One query match -> a candidate element, or null when the pattern binds no element capture. */
function candidateOf(match: QueryMatch): Candidate | null {
  const capture = elementCaptureOf(match);
  if (capture === null) return null;
  const elementNode = match.captures.find((c) => c.name === capture)!.node;
  const name = match.captures.find((c) => c.name === NAME_CAPTURE)?.node.text;
  return {
    pattern: match.patternIndex,
    capture,
    node: {
      startIndex: elementNode.startIndex,
      endIndex: elementNode.endIndex,
      startPosition: elementNode.startPosition,
      endPosition: elementNode.endPosition,
      text: elementNode.text,
      type: elementNode.type,
    },
    name,
  };
}

function contains(outer: Candidate, inner: Candidate): boolean {
  return (
    outer.node.startIndex <= inner.node.startIndex && outer.node.endIndex >= inner.node.endIndex
  );
}

/**
 * Resolve candidate conflicts, in order: same-node double capture resolves by PATTERN ORDER (the
 * earlier .scm pattern wins - the callable-initializer refinement depends on it); same-capture
 * nesting keeps the outer element; and the per-noun descent default drops captures strictly inside
 * a @function or @binding element (opaque interiors). Different-capture overlap inside a
 *
 * @type element is legal.
 */
export function resolveCandidates(candidates: readonly Candidate[]): Candidate[] {
  const byNode = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidate.node.startIndex + ":" + candidate.node.endIndex;
    const existing = byNode.get(key);
    if (existing === undefined || candidate.pattern < existing.pattern) byNode.set(key, candidate);
  }
  const ordered = [...byNode.values()].sort(
    (a, b) => a.node.startIndex - b.node.startIndex || b.node.endIndex - a.node.endIndex,
  );
  const kept: Candidate[] = [];
  for (const candidate of ordered) {
    const swallowed = kept.some((outer) => hides(outer, candidate));
    if (!swallowed) kept.push(candidate);
  }
  return kept;
}

const OPAQUE: ReadonlySet<string> = new Set(["function", "binding"]);

/** Does the outer candidate hide the inner one? (suppression policy - see the header) */
function hides(outer: Candidate, inner: Candidate): boolean {
  // comments and imports never hide: they stay candidates so the materializer can count them
  // internal and keep the imports run whole
  if (inner.capture === "comment" || inner.capture === "import") return false;
  if (!contains(outer, inner)) return false;
  if (outer.capture === inner.capture) return true;
  return OPAQUE.has(outer.capture) && inner.node.startIndex !== outer.node.startIndex;
}

export function spanOf(node: QueryNode): Span {
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

/** Run a compiled query over a tree and return its candidates in match (document) order. */
export function runQuery(query: Query, rootNode: QueryMatchSource): Candidate[] {
  const candidates: Candidate[] = [];
  for (const match of query.matches(rootNode as never)) {
    const candidate = candidateOf(match);
    if (candidate !== null) candidates.push(candidate);
  }
  return candidates;
}
