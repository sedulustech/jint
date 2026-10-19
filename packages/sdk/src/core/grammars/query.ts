/**
 * The query runtime: a grammar's queries.scm IS the mapping. The .scm assigns jint-owned captures
 * to matched nodes; this file turns matches into candidate elements and resolves the overlap
 * policy. The decompose runtime holds no node-type names; it sees only captures.
 *
 * Capture vocabulary (frozen for v1; a capture name is an identity, never a label):
 *
 * @function @method @class @type @binding @comment @import - what one element IS (singular)
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
 *   - per-capture descent defaults: a @type element's interior surfaces (a method is an element of
 *     its own); a @function or @binding interior is OPAQUE to DIFFERENT captures - a local binding
 *     inside a function body is implementation - while a SAME-capture nest surfaces as a child of
 *     its own unless it is absorb-shaped (nested function declarations; the it/beforeEach calls
 *     inside a describe composite). This is the query shape of the old composite-descent limit,
 *     settled by the typescript parity run.
 *   - unlisted nodes passthrough: a node no pattern captures yields nothing and blocks nothing.
 *
 * Static analysis of the .scm over-approximates under predicates (a captured node may be filtered
 * by #eq?/#match? at match time) - capture-vocabulary validation is therefore a loud check on the
 * NAMES a query uses, never on the nodes they will bind.
 */

import { ruleTargets } from "@jint/contract";
import { Query, type QueryMatch } from "web-tree-sitter";
import { SetupError, type Span } from "../types.ts";
import { grammar, knownLanguages, type GrammarRegistry } from "./grammars.ts";

/**
 * The element captures, frozen for v1. A query capturing anything else fails at load.
 *
 * @docstring is a COMMENT-KIND capture: a grammar's docstring convention, captured by pattern
 * (python's string-in-block) and owned by its enclosing definition (docstringOf) - the capture
 * seam is the ONE authority for what a docstring is; the decompose runtime holds no node-type names.
 */
export const ELEMENT_CAPTURES = [
  "function",
  "method",
  "class",
  "type",
  "binding",
  "comment",
  "import",
  "docstring",
  // markdown-only element captures (the BYOG precedent for grammar-autonomous vocabulary) -
  // never a code capture, no shared target addresses them. section: prose's container-with-body,
  // self-nesting per the .scm's #set! directive. paragraph: flat prose - paragraphs never nest.
  "section",
  "paragraph",
] as const;
export type Capture = (typeof ELEMENT_CAPTURES)[number];

/**
 * RESERVED capture tokens: valid in a query, validated, but emitted by no grammar today. `test` is
 * held for the test capture (design: Test identification) so the name cannot be coined twice when
 * it ships; a query binding it produces no element until a grammar assigns it to a node.
 */
export const RESERVED_CAPTURES = ["test"] as const;

/**
 * THE SUPPRESSION POLICY TABLE - keyed by the OUTER capture; the cpp field/prototype and
 * verilog-trial nested-always questions port here as DATA, never as new if-branches in hides().
 *
 * AbsorbTail - the largest wrapper tail (bytes between a same-capture payload's end and the
 * wrapper's end) that still reads as PREFIX-ABSORB: one logical element, the wrapper survives, the
 * payload dies (export statement, decorated definition, template declaration + trailing ';'). A
 * same-capture nest with a LARGER tail is a unit of its own and SURFACES as a child (nested
 * functions; the parity verdict kept that). A selfNesting grammar (markdown) disables same-capture
 * collapse entirely (a .scm #set! directive). opaque - a DIFFERENT-capture capture strictly inside
 * this element is implementation and dies (a local binding inside a function); a show-through
 * interior (@type) surfaces its captures.
 */
const POLICY: Readonly<Record<Capture, { readonly absorbTail: number; readonly opaque: boolean }>> =
  {
    function: { absorbTail: 0, opaque: true },
    // method: function's shape (a nested method with a real body surfaces as a child)
    method: { absorbTail: 0, opaque: true },
    // class: type's shape (show-through interior - its methods surface as elements)
    class: { absorbTail: 2, opaque: false },
    type: { absorbTail: 2, opaque: false },
    // section: type's shape (markdown's container-with-body; the .scm's #set! "selfNesting"
    // directive lets sections nest) - show-through interior, no absorb
    section: { absorbTail: 2, opaque: false },
    // paragraph: markdown's flat prose - paragraphs never nest, nothing nests inside them
    paragraph: { absorbTail: 0, opaque: false },
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
const KNOWN_CAPTURES: ReadonlySet<string> = new Set([
  ...ELEMENT_CAPTURES,
  ...RESERVED_CAPTURES,
  NAME_CAPTURE,
]);

/**
 * PATTERN-ORDER VALIDATION: when two patterns root on the same node type but assign DIFFERENT
 * element captures, the order between them is load-bearing (the earlier pattern wins) - silence
 * there is the highest-risk invariant an agent reordering patterns can break.
 *
 * The boundary is PER PATTERN, not per group: every pattern that takes part in a same-root conflict
 * must carry the directive, because each one's POSITION is what the runtime reads (a directive on
 * the last pattern alone would leave the earlier ones silently order-bearing). A pattern with no
 * directive in a conflicting root group fails the run at setup.
 *
 * Root node type is read from the COMPILED query's pattern offsets (startIndexForPattern /
 * endIndexForPattern), so multi-line patterns report their real root rather than a continuation
 * line; comments and the pattern's own leading whitespace are stripped before the root token is
 * taken. Over-approximation remains (two patterns may root on the same type yet never match the
 * same node) - forcing the one-line statement is the point.
 */
export interface ScmPattern {
  readonly pattern: number;
  readonly rootType: string;
  readonly capture: Capture | null;
  readonly intentional: boolean;
}

/**
 * Split a .scm into its top-level patterns with a depth scanner (comments and string literals
 * ignored), so each pattern's OWN text supplies its root node type and its directive. The compiled
 * query's offsets are deliberately not used: startIndex/endIndex point at captured nodes, not at
 * pattern boundaries, which made multi-line patterns report an inner token as their root (the
 * merge-gate finding).
 */
function splitPatterns(scm: string): { text: string; precededBy: string }[] {
  const patterns: { text: string; precededBy: string }[] = [];
  let depth = 0;
  let start = -1;
  // index of the closing paren, pinned when depth returns to 0
  let open = -1;
  let inString = false;
  let comments = "";
  let pendingComments = "";
  const flush = (tailEnd: number) => {
    if (open === -1) return;
    patterns.push({
      text: scm.slice(start, Math.max(open + 1, tailEnd)),
      precededBy: pendingComments,
    });
    start = -1;
    open = -1;
    pendingComments = "";
  };
  for (let i = 0; i < scm.length; i++) {
    const char = scm[i]!;
    if (inString) {
      if (char === '"' && scm[i - 1] !== "\\") inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === ";") {
      const eol = scm.indexOf("\n", i);
      const end = eol === -1 ? scm.length : eol;
      const comment = scm.slice(i, end);
      if (open !== -1 && start !== -1) {
        // trailing comment inside the pattern's tail: keep it (directives ride there)
        i = end;
        continue;
      }
      comments += comment + "\n";
      i = end;
      continue;
    }
    if (char === "(") {
      if (depth === 0) {
        if (open !== -1) flush(i);
        start = i;
        pendingComments = comments;
        comments = "";
      }
      depth++;
      continue;
    }
    if (char === ")") {
      depth--;
      if (depth === 0) open = i;
      continue;
    }
    if (depth === 0 && char.trim() !== "" && open === -1) comments = "";
  }
  flush(scm.length);
  return patterns;
}

/**
 * Blank out string literals (single- or double-quoted, backslash-escaped) so predicates that merely
 * MENTION a word - (#match? @name "@priority") - cannot fake a directive, a capture, or a root
 * token. The quoted text is replaced by spaces, keeping offsets and line structure. SHARED: every
 * .scm text reader (patterns, directives, emitted captures) blanks strings through this one
 * function - one discipline, no reader that leaks a mention into a fact.
 */
export function withoutStrings(text: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quote === null) {
      if (char === '"' || char === "'") {
        quote = char;
        out += " ";
        continue;
      }
      out += char;
      continue;
    }
    if (char === "\\") {
      out += "  ";
      i++;
      continue;
    }
    if (char === quote) {
      quote = null;
      out += " ";
      continue;
    }
    out += char === "\n" ? "\n" : " ";
  }
  return out;
}

/**
 * The .scm CODE view, shared by every fact reader: `;` comments cut (only where the `;` is real
 * syntax - outside string literals, so an apostrophe in a comment cannot open a phantom quote),
 * THEN string literals blanked (a mention inside a predicate string is not syntax). Both steps
 * quote-aware: the naive orderings leak (comments first lets trailing-comment tokens survive;
 * blanking first over a full file lets a comment apostrophe swallow real code into a phantom
 * string).
 */
export function scmCode(scm: string): string {
  let commentsCut = "";
  let quote: string | null = null;
  for (let i = 0; i < scm.length; i++) {
    const char = scm[i]!;
    if (quote !== null) {
      commentsCut += char;
      if (char === "\\") {
        commentsCut += scm[i + 1] ?? "";
        i++;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === ";") {
      while (i < scm.length && scm[i] !== "\n") i++;
      commentsCut += "\n";
      continue;
    }
    if (char === '"' || char === "\'") quote = char;
    commentsCut += char;
  }
  return withoutStrings(commentsCut);
}

/**
 * THE directive vocabulary: every #set! fact a queries.scm may declare, with the value shape each
 * name accepts. Naming principle: the prefix names the grouper (attach, docstring, import), the
 * suffix the knob (gap, owner, merge), the value the setting - a name never names a node; the
 * pattern the directive sits on IS the target. presence = a boolean knob declared by its name alone
 * (its presence is the setting); number = a whole count; enum = one listed word. The engine parses
 * the same directives natively (QueryMatch.setProperties) - this table is the LOAD-TIME authority
 * for names and value shapes; the walker reads the engine's values.
 */
const DIRECTIVES = {
  selfNesting: { kind: "presence" },
  "attach.gap": { kind: "number" },
  "docstring.owner": { kind: "enum", values: ["next", "enclosing"] },
  "import.merge": { kind: "enum", values: ["contiguous", "none"] },
} as const;
type DirectiveName = keyof typeof DIRECTIVES;

/** One #set! occurrence that is real syntax: outside strings, outside comments. */
interface ScmDirective {
  readonly name: string;
  /** The declared value, when the directive form carries one (#set! "name" "value"). */
  readonly value?: string;
  readonly line: number;
}

/**
 * The .scm's #set! directives, found syntactically: a #set! counts only OUTSIDE string literals and
 * OUTSIDE ; comments (a trailing comment or a predicate string cannot fake a directive), and the
 * quoted directive name survives - it IS a string literal, so strings stay intact here while the
 * scan tracks quote state positionally. Single pass, line-faithful.
 */
export function scmDirectives(scm: string): ScmDirective[] {
  const directives: ScmDirective[] = [];
  let line = 1;
  let quote: string | null = null;
  let i = 0;
  while (i < scm.length) {
    const char = scm[i]!;
    if (char === "\n") {
      line++;
      i++;
      continue;
    }
    if (quote !== null) {
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i++;
      continue;
    }
    if (char === ";") {
      while (i < scm.length && scm[i] !== "\n") i++;
      continue;
    }
    if (char === "#" && scm.slice(i, i + 4) === "#set") {
      const bang = scm[i + 4] === "!";
      i += 4;
      // past the bang, onto the (required) quoted name, then the (optional) quoted value
      if (bang) i++;
      while (i < scm.length && scm[i] === " ") i++;
      const nameMatch = scm.slice(i).match(/^"([A-Za-z0-9_.-]+)"/);
      const name = nameMatch?.[1];
      if (!bang) {
        throw new SetupError(
          "CONFIG_INVALID",
          `grammar queries.scm line ${line}: "#set" is malformed - the directive form is #set! "<name>" ["<value>"]`,
        );
      }
      if (name === undefined) {
        throw new SetupError(
          "CONFIG_INVALID",
          `grammar queries.scm line ${line}: #set! is missing its quoted directive name (known: ${(
            Object.keys(DIRECTIVES) as DirectiveName[]
          ).join(", ")})`,
        );
      }
      i += nameMatch![0]!.length;
      while (i < scm.length && scm[i] === " ") i++;
      const valueMatch = scm.slice(i).match(/^"((?:[^"\\]|\\.)*)"/);
      directives.push({ name, value: valueMatch?.[1], line });
      if (valueMatch !== null) i += valueMatch[0]!.length;
      continue;
    }
    if (char === '"' || char === "\'") quote = char;
    i++;
  }
  return directives;
}

/**
 * Loud directive validation at .scm load: a #set! naming an unknown directive, or carrying a value
 * its name does not accept, is a setup error naming the line and what it wants - a directive that
 * silently no-ops is a grammar author's false belief about their own extraction. One name, one
 * setting per file: the same directive declared twice with different values is the same loudness
 * (the knobs are grammar-level facts; per-pattern disagreement would be two behaviors under one
 * name). Unknown predicate forms (#eq?, #match?, ...) stay tree-sitter's business; only the #set
 * family is ours.
 */
export function assertScmDirectives(scm: string, grammarId: string): void {
  const known = Object.keys(DIRECTIVES) as DirectiveName[];
  const seen = new Map<string, { readonly value: string | undefined; readonly line: number }>();
  for (const directive of scmDirectives(scm)) {
    const shape = DIRECTIVES[directive.name as DirectiveName];
    if (shape === undefined) {
      throw new SetupError(
        "CONFIG_INVALID",
        `grammar ${grammarId} queries.scm line ${directive.line}: unknown directive "${directive.name}" (known: ${known.join(", ")})`,
      );
    }
    const wants =
      shape.kind === "presence"
        ? `${directive.name} is presence-only - it takes no value`
        : shape.kind === "number"
          ? `${directive.name} wants a whole number`
          : `${directive.name} wants one of: ${shape.values.join(", ")}`;
    if (shape.kind === "presence" && directive.value !== undefined) {
      throw new SetupError(
        "CONFIG_INVALID",
        `grammar ${grammarId} queries.scm line ${directive.line}: ${wants} (got "${directive.value}")`,
      );
    }
    if (
      (shape.kind === "number" && !/^\d+$/.test(directive.value ?? "")) ||
      (shape.kind === "enum" &&
        !(shape.values as readonly string[]).includes(directive.value ?? ""))
    ) {
      throw new SetupError(
        "CONFIG_INVALID",
        `grammar ${grammarId} queries.scm line ${directive.line}: ${wants} (got ${directive.value === undefined ? "no value" : `"${directive.value}"`})`,
      );
    }
    const prior = seen.get(directive.name);
    if (prior !== undefined && prior.value !== directive.value) {
      throw new SetupError(
        "CONFIG_INVALID",
        `grammar ${grammarId} queries.scm line ${directive.line}: directive "${directive.name}" is set twice with different values (line ${prior.line} set "${prior.value ?? ""}") - one name, one setting per file`,
      );
    }
    seen.set(directive.name, { value: directive.value, line: directive.line });
  }
}

/** Does the .scm set the selfNesting shape directive? (real syntax only; see scmDirectives) */
export function scmSelfNesting(scm: string): boolean {
  return scmDirectives(scm).some((d) => d.name === "selfNesting");
}
export function parseScmPatterns(scm: string): ScmPattern[] {
  return splitPatterns(scm).map((pattern, index) => {
    // comments and string literals both go: only real syntax names a root, a capture or a
    // directive (a predicate string mentioning @priority must not fake one)
    // text with string literals blanked but COMMENTS INTACT: the directive is a comment, so it
    // must survive here while a predicate string cannot fake it
    const unquoted = withoutStrings(pattern.text);
    const code = unquoted.replace(/;.*$/gm, "");
    const rootType = (code.slice(1).split(/[\s:()]/)[0] ?? "").trim();
    const captures = [...code.matchAll(CAPTURE_TOKEN)].map((m) => m[1]!);
    const capture =
      captures.find((n): n is Capture => (ELEMENT_CAPTURES as readonly string[]).includes(n)) ??
      null;
    return {
      pattern: index,
      rootType,
      capture,
      // the directive rides a preceding comment line OR a trailing comment inside the pattern
      intentional: /@priority\b/.test(pattern.precededBy) || /@priority\b/.test(unquoted),
    };
  });
}

/**
 * Count cross-check: our scanner must see exactly the patterns the grammar compiled. A stray paren
 * or quote can collapse (or grow) our pattern list silently - the validator would then reason about
 * a file the grammar reads differently - so a mismatch is a broken .scm and fails by name.
 * tree-sitter rejects most such files first; this catches the ones it tolerates.
 */
export function assertPatternCount(language: string, scm: string, compiledCount: number): void {
  const parsedCount = parseScmPatterns(scm).length;
  if (parsedCount !== compiledCount) {
    throw new SetupError(
      "CONFIG_INVALID",
      `query patterns for ${language}: parsed ${String(parsedCount)} pattern(s) from queries.scm but the grammar compiled ${String(compiledCount)} - the file is unbalanced (a stray paren or quote)`,
    );
  }
}

export function validatePatternOrder(language: string, scm: string): void {
  const patterns = parseScmPatterns(scm);
  const byRoot = new Map<string, ScmPattern[]>();
  for (const p of patterns) {
    if (p.capture === null || p.rootType === "") continue;
    const group = byRoot.get(p.rootType) ?? [];
    group.push(p);
    byRoot.set(p.rootType, group);
  }
  for (const [rootType, group] of byRoot) {
    const captures = new Set(group.map((p) => p.capture));
    if (captures.size <= 1) continue;
    const unstated = group.filter((p) => !p.intentional);
    if (unstated.length === 0) continue;
    const detail = group
      .map((p) => `pattern ${p.pattern}: @${p.capture}${p.intentional ? "" : " (unstated)"}`)
      .join("; ");
    const winner = group[0]!;
    throw new SetupError(
      "CONFIG_INVALID",
      `${language}: patterns ${detail} root at node type "${rootType}" and can match the same node with different captures - ` +
        `when two of them match one node, the EARLIER pattern's capture wins (${winner.capture} from pattern ${winner.pattern}) and the later one never fires for it; ` +
        `an "; @priority" comment on EVERY pattern in the group states this order is deliberate - add it, or reorder the patterns`,
    );
  }
}

/**
 * Every node type an .scm names in a named-node position - real syntax only (strings blanked,
 * comments cut through the SHARED readers): a node type mentioned in a predicate string or prose is
 * a mention, not a fact. Wildcards (_), anchors (. ^) and predicates (#...) never match.
 */
function scmNodeTypes(scm: string): string[] {
  return [...scmCode(scm).matchAll(/\(([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]!);
}

/**
 * Compile + fully validate one .scm against its language (vocabulary, #set! directives,
 * pattern-order conflicts - the loud checks every extraction source goes through). UNCACHED: the
 * custom-query path (capture() with a query file) may compile several .scm against one language in
 * a process; the embedded path caches per language below.
 *
 * NODE-VOCABULARY GUARD: every node type the .scm names must exist in the grammar it is compiled
 * against - an .scm authored for another grammar is a cross-grammar handoff and fails loud, naming
 * every unknown type in one error (tree-sitter's own compile error names one at a time in its
 * voice; the pre-check precedes it). The loaded language object is the authority, so embedded and
 * custom grammars get the identical check with no mirrored node-types file.
 */
export async function compileQuery(
  language: string,
  scm: string,
  lang: import("web-tree-sitter").Language,
): Promise<Query> {
  const unknownNodeTypes = [
    ...new Set(scmNodeTypes(scm).filter((type) => lang.idForNodeType(type, true) === null)),
  ].sort();
  if (unknownNodeTypes.length > 0) {
    throw new SetupError(
      "CONFIG_INVALID",
      "query for " +
        language +
        " names node types the grammar does not have: " +
        unknownNodeTypes.join(", ") +
        " - the .scm is authored for another grammar",
    );
  }
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
  assertPatternCount(language, scm, query.patternCount());
  assertScmDirectives(scm, language);
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
}

/** Compile one grammar's .scm; memoized per grammar content. */
const compiled = new Map<string, Promise<Query>>();

export function queryFor(
  entry: import("./grammars.ts").GrammarEntry,
  scm: string,
  lang: import("web-tree-sitter").Language,
): Promise<Query> {
  // keyed by the SERVING WASM and the .scm content: registry values may serve different wasms
  // under one language id (a custom grammar overriding an embedded one), so the language id alone
  // could hand one grammar's compiled query to another's parse - the wasm path is the parse
  // identity, the .scm content the extraction identity, and identical pairs reuse the compile
  const key = entry.wasmPath + "|" + scm;
  let cached = compiled.get(key);
  if (cached) return cached;
  const created = compileQuery(entry.language, scm, lang);
  compiled.set(key, created);
  return created;
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
  /**
   * The pattern's #set! facts as the ENGINE parsed them (QueryMatch.setProperties), keyed by
   * directive name - the walker's grouping knobs travel here, validated separately at load
   * (assertScmDirectives) and read with code defaults when absent.
   */
  readonly properties?: Readonly<Record<string, string | null>>;
}

/**
 * The element capture of one match (the first capture in the pattern), or null for name-only
 * patterns.
 */
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
  // THE CONTAINER-BINDING TRAP, loud: a pattern like (enum_body (property_identifier) @name)
  // @binding binds @name on EVERY member of the container while the element is the whole
  // container - any one member's text as its name is arbitrary. One element carries one name;
  // the honest shapes are a single @name binding or one element per member.
  const nameCaptures = match.captures.filter((c) => c.name === NAME_CAPTURE);
  if (nameCaptures.length > 1) {
    throw new SetupError(
      "CONFIG_INVALID",
      "query pattern " +
        String(match.patternIndex + 1) +
        " binds @name on " +
        String(nameCaptures.length) +
        " nodes in one match (" +
        [...new Set(nameCaptures.map((c) => c.node.type))].join(", ") +
        ") - one element carries one name; bind @name to a single node or capture each member as its own element",
    );
  }
  const name = nameCaptures[0]?.node.text;
  const properties =
    match.setProperties !== undefined && Object.keys(match.setProperties).length > 0
      ? match.setProperties
      : undefined;
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
    properties,
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
  options: SuppressionOptions = {},
): Candidate[] {
  const byNode = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidate.node.startIndex + ":" + candidate.node.endIndex;
    const existing = byNode.get(key);
    // THE CONTAINER-BINDING TRAP, the multi-match half: a container pattern like
    // (enum_body (property_identifier) @name) @binding matches ONCE PER member - each match
    // carries a different member's @name onto the SAME node. One element carries one name; the
    // first match must not silently win the naming. (candidateOf guards the one-match half: a
    // single match binding @name on several nodes.)
    if (
      existing !== undefined &&
      existing.pattern === candidate.pattern &&
      existing.name !== candidate.name
    ) {
      throw new SetupError(
        "CONFIG_INVALID",
        "query pattern " +
          String(existing.pattern + 1) +
          " names one node twice (" +
          [existing.name ?? "-", candidate.name ?? "-"].join(", ") +
          ") - one element carries one name; bind @name to a single node or capture each member as its own element",
      );
    }
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

/** Grammar-declared structure facts that modulate suppression (.scm #set! directives). */
export interface SuppressionOptions {
  readonly selfNesting?: boolean;
}

function effectivePolicy(capture: Capture): {
  readonly absorbTail: number;
  readonly opaque: boolean;
} {
  return POLICY[capture];
}

function selfNestingOf(options: SuppressionOptions): boolean {
  return options.selfNesting === true;
}

/**
 * THE capture token: what a .scm names a capture with. Shared by every .scm text reader (pattern
 * parsing, emitted-capture derivation) - two regexes for one fact is two facts waiting to drift.
 */
export const CAPTURE_TOKEN = /@([A-Za-z_][A-Za-z0-9_-]*)/g;
/** Does the outer candidate hide the inner one? (policy table + .scm #set! facts; ordered) */
function hides(outer: Candidate, inner: Candidate, options: SuppressionOptions): boolean {
  // lane captures travel intact: the materializer counts them internal and keeps runs whole
  if (LANES.has(inner.capture)) return false;
  if (!contains(outer, inner)) return false;
  if (outer.capture === inner.capture) {
    if (selfNestingOf(options)) return false;
    // prefix-absorb shape: the wrapper carries at most the capture's tail tolerance (';') past
    // its payload; a larger tail is a unit of its own and surfaces as a child
    return inner.node.endIndex >= outer.node.endIndex - effectivePolicy(outer.capture).absorbTail;
  }
  return effectivePolicy(outer.capture).opaque;
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

/**
 * The captures a grammar EMITS: derived syntactically from its queries - the .scm IS the grammar's
 * interface, single source, no second authority. SYNTACTIC on purpose: a capture bound only under a
 * predicate still counts as emitted (the .scm names it; predicates gate matching, not vocabulary).
 * Element captures only - @name and reserved tokens are not targets. `;` comment lines are stripped
 * first: prose naming a capture does not emit it.
 */
export function emittedCaptures(registry: GrammarRegistry, grammarId: string): readonly string[] {
  // the SHARED .scm reader: strings blanked, then comments cut - a capture named in a trailing
  // comment or a predicate string is prose, not an emitted fact (an address must never validate
  // against a capture the grammar would not actually extract)
  const scm = scmCode(grammar(registry, grammarId).queries);
  const named = new Set([...scm.matchAll(CAPTURE_TOKEN)].map((m) => m[1]!));
  return ELEMENT_CAPTURES.filter((c) => named.has(c));
}
const QUALIFIED_ADDRESS = /^([a-z][a-z0-9_-]*):([a-z][a-z0-9_-]*)$/;

const SHARED_TARGETS: ReadonlySet<string> = new Set(ruleTargets);

/**
 * THE capture-address gate, run at LINT STARTUP (over the run's registry value, before any file
 * walks): a qualified address is checked against the registry the run holds - a shadow grammar
 * REPLACES its embedded extraction, so the emitted set for an id is the shadow's once merged. Two
 * distinguished failures: grammar not registered (named with the loaded ids) vs capture not emitted
 * (named with that grammar's ACTUAL emitted set - shadow-derived when a shadow exists). A bare name
 * that is neither a shared target nor an address is a typo and fails loudly too. Config load stays
 * grammar-blind (no registry is built there); the loudness point in the user's experience is
 * identical: CONFIG_INVALID, nothing measured.
 */
export function assertCaptureAddress(target: string, registry: GrammarRegistry): void {
  const match = target.match(QUALIFIED_ADDRESS);
  if (match === null) {
    if (SHARED_TARGETS.has(target)) return;
    throw new SetupError(
      "CONFIG_INVALID",
      'unknown target "' +
        target +
        '" (shared targets: ' +
        [...SHARED_TARGETS].join(", ") +
        "; or a grammar-scoped capture address: grammar:capture)",
    );
  }
  const grammarId = match[1]!;
  const capture = match[2]!;
  const loaded = knownLanguages(registry);
  if (!loaded.includes(grammarId)) {
    throw new SetupError(
      "CONFIG_INVALID",
      'capture address "' +
        target +
        '" names an unknown grammar "' +
        grammarId +
        '" (loaded grammars: ' +
        loaded.join(", ") +
        ")",
    );
  }
  const emitted = emittedCaptures(registry, grammarId);
  if (!emitted.includes(capture)) {
    throw new SetupError(
      "CONFIG_INVALID",
      'capture address "' +
        target +
        '": grammar "' +
        grammarId +
        '" does not emit "' +
        capture +
        '" (' +
        grammarId +
        " emits: " +
        emitted.join(", ") +
        ")",
    );
  }
}
