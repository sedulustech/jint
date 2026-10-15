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

/**
 * The element captures, frozen for v1. A query capturing anything else fails at load.
 *
 * @docstring is a COMMENT-KIND capture: a grammar's docstring convention, captured by pattern
 * (python's string-in-block) and owned by its enclosing definition (docstringOf) - the capture
 * seam is the ONE authority for what a docstring is; the walker holds no node-type names.
 */
export const ELEMENT_CAPTURES = [
  "function",
  "type",
  "binding",
  "comment",
  "import",
  "docstring",
] as const;
export type Capture = (typeof ELEMENT_CAPTURES)[number];

/**
 * THE SUPPRESSION POLICY TABLE - keyed by the OUTER capture; the cpp field/prototype and verilog
 * nested-always questions port here as DATA, never as new if-branches in hides().
 *
 * AbsorbTail - the largest wrapper tail (bytes between a same-capture payload's end and the
 * wrapper's end) that still reads as PREFIX-ABSORB: one logical element, the wrapper survives, the
 * payload dies (export statement, decorated definition, template declaration + trailing ';'). A
 * same-capture nest with a LARGER tail is a unit of its own and SURFACES as a child (nested
 * functions; the parity verdict kept that). A selfNesting grammar (markdown) disables same-capture
 * collapse entirely (a manifest fact). opaque - a DIFFERENT-capture capture strictly inside this
 * element is implementation and dies (a local binding inside a function); a show-through interior
 * (@type) surfaces its captures.
 */
const POLICY: Readonly<Record<Capture, { readonly absorbTail: number; readonly opaque: boolean }>> =
  {
    function: { absorbTail: 0, opaque: true },
    type: { absorbTail: 2, opaque: false },
    binding: { absorbTail: 2, opaque: true },
    // lanes: never containers of elements; the lanes themselves never hide
    comment: { absorbTail: 0, opaque: false },
    import: { absorbTail: 0, opaque: false },
    docstring: { absorbTail: 0, opaque: false },
  };

/** Lane captures, never contained elements: exempt from every suppression rule. */
const LANES: ReadonlySet<Capture> = new Set(["comment", "import", "docstring"]);

/** Renders a definition's name; present only when a pattern binds it. */
const NAME_CAPTURE = "name";
const KNOWN_CAPTURES: ReadonlySet<string> = new Set([...ELEMENT_CAPTURES, NAME_CAPTURE]);

/**
 * PATTERN-ORDER VALIDATION: when two patterns root on the same node type but assign DIFFERENT
 * element captures, the order between them is load-bearing (the earlier pattern wins) - silence
 * there is the highest-risk invariant an agent reordering patterns can break. Such a pair must be
 * stated: each involved pattern carries an "; @priority" directive comment. A pair without the
 * directive fails the run at setup, naming the patterns and the fix.
 *
 * Root node type = the first token of the pattern (conservative: two patterns may root on the same
 * type yet never match the same node - over-approximation forces explicitness, which is the point;
 * a false positive costs one comment line).
 */
export interface ScmPattern {
  readonly pattern: number;
  readonly rootType: string;
  readonly capture: Capture | null;
  readonly intentional: boolean;
}

/** Parse the .scm's patterns structurally: element capture, root node type, @priority directive. */
export function parseScmPatterns(scm: string): ScmPattern[] {
  const patterns: ScmPattern[] = [];
  let directive = false;
  for (const line of scm.split("\n")) {
    const text = line.trim();
    if (text.startsWith(";")) {
      if (/@priority\b/.test(text)) directive = true;
      continue;
    }
    if (text.length === 0) {
      directive = false;
      continue;
    }
    const rootType = text.slice(1).split(/[\s:()]/)[0] ?? "";
    const captureMatch = text.match(/@\w+/g);
    const capture =
      (captureMatch ?? [])
        .map((c) => c.slice(1))
        .find((n): n is Capture => (ELEMENT_CAPTURES as readonly string[]).includes(n)) ?? null;
    patterns.push({
      pattern: patterns.length,
      rootType,
      capture,
      // the directive rides a preceding comment line OR a trailing comment on the pattern line
      intentional: directive || /;\s*@priority\b/.test(text),
    });
    directive = false;
  }
  return patterns;
}

export function validatePatternOrder(language: string, scm: string): void {
  const patterns = parseScmPatterns(scm);
  const byRoot = new Map<string, ScmPattern[]>();
  for (const p of patterns) {
    if (p.capture === null) continue;
    const group = byRoot.get(p.rootType) ?? [];
    group.push(p);
    byRoot.set(p.rootType, group);
  }
  for (const [rootType, group] of byRoot) {
    const captures = new Set(group.map((p) => p.capture));
    if (captures.size <= 1) continue;
    // one stated intent is enough for the whole conflicting group: it says "this order is
    // load-bearing on purpose"; silence anywhere in the group is the failure
    if (group.some((p) => p.intentional)) continue;
    const detail = group
      .map((p) => `pattern ${p.pattern}: @${p.capture} on ${p.rootType}`)
      .join("; ");
    throw new SetupError(
      "CONFIG_INVALID",
      `${language}: patterns ${detail} share root node type "${rootType}" with different captures - ` +
        `the order between them is load-bearing; state the intent with an "; @priority" comment on one pattern of the group`,
    );
  }
}

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
    validatePatternOrder(language, scm);
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
 * earlier .scm pattern wins - the callable-initializer refinement depends on it); then the
 * suppression policy table decides what a contained candidate is - an absorbed payload, a child of
 * its own, or implementation that dies.
 */
export function resolveCandidates(
  candidates: readonly Candidate[],
  options: ResolveOptions = {},
): Candidate[] {
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
    const swallowed = kept.some((outer) => hides(outer, candidate, options));
    if (!swallowed) kept.push(candidate);
  }
  return kept;
}

/**
 * Grammar-declared policy overrides (manifest: policy). Keys are captures or "selfNesting"; absent
 * keys keep the POLICY table defaults - simple grammars stay zero-config.
 */
export interface PolicyOverrides {
  readonly selfNesting?: boolean;
  readonly [capture: string]:
    | { readonly opaque?: boolean; readonly absorbTail?: number }
    | boolean
    | undefined;
}

/** Grammar-declared structure facts that modulate suppression (manifest policy, see above). */
export interface ResolveOptions {
  readonly selfNesting?: boolean;
  readonly overrides?: PolicyOverrides;
}

function effectivePolicy(
  capture: Capture,
  options: ResolveOptions,
): { readonly absorbTail: number; readonly opaque: boolean } {
  const override = options.overrides?.[capture];
  const base = POLICY[capture];
  if (override === undefined || typeof override === "boolean") return base;
  return {
    absorbTail: override.absorbTail ?? base.absorbTail,
    opaque: override.opaque ?? base.opaque,
  };
}

function selfNestingOf(options: ResolveOptions): boolean {
  return options.overrides?.selfNesting === true || options.selfNesting === true;
}

/** Does the outer candidate hide the inner one? (policy table + manifest overrides; ordered) */
function hides(outer: Candidate, inner: Candidate, options: ResolveOptions): boolean {
  // lane captures travel intact: the materializer counts them internal and keeps runs whole
  if (LANES.has(inner.capture)) return false;
  if (!contains(outer, inner)) return false;
  if (outer.capture === inner.capture) {
    if (selfNestingOf(options)) return false;
    // prefix-absorb shape: the wrapper carries at most the capture's tail tolerance (';') past
    // its payload; a larger tail is a unit of its own and surfaces as a child
    return (
      inner.node.endIndex >=
      outer.node.endIndex - effectivePolicy(outer.capture, options).absorbTail
    );
  }
  return effectivePolicy(outer.capture, options).opaque;
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
