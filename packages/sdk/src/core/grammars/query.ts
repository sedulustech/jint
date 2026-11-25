/**
 * The query runtime: a grammar's queries.scm IS the mapping. The .scm assigns jint-owned captures
 * to matched nodes; this file turns matches into candidate elements and resolves the overlap
 * policy. The decompose runtime holds no node-type names; it sees only captures.
 *
 * Capture vocabulary (frozen for v1; a capture name is an identity, never a label):
 *
 * @function @method @class @type @binding @comment @import - what one element IS (singular) import
 *   { SHARED_LANES } from "./shared.ts"; import { CAPTURE_ADDRESS, CAPTURE_NAME } from
 *   "./capture-address.ts";
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
 *     its own); a @function or @binding interior is a LEAF to DIFFERENT captures - a local binding
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

import { RULE_TARGETS } from "@jint/contract";
import { CAPTURE_ADDRESS, CAPTURE_NAME } from "./capture-address.ts";
import {
  isSharedCapture,
  SHARED_ELEMENT_CAPTURES,
  SHARED_LANES,
  type SuppressionShape,
} from "./shared.ts";

export type { SuppressionShape };
import { Query, type QueryMatch } from "web-tree-sitter";
import { SetupError, type Span } from "../types.ts";
import { grammar, knownLanguages, type GrammarRegistry } from "./grammars.ts";

export const BASE_MARKER = "; --- the grammar's own queries.scm, extended above ---";

/**
 * A capture name: a shared capture, or one the owning grammar's .scm declares with a
 * `capture.<name>.definition` directive. A capture that is neither fails at load, naming the fix.
 * `docstring` is comment-kind: the definition that encloses it owns it.
 */
export type Capture = string;

/**
 * Capture tokens a query may bind that produce no element. `test` is reserved for a test capture,
 * so the name cannot be coined for anything else.
 */
export const RESERVED_CAPTURES = ["test"] as const;

/** The suppression overrides one grammar's .scm declares; undeclared captures keep defaults. */
export function scmCapturePolicy(scm: string): ReadonlyMap<string, Partial<SuppressionShape>> {
  const declared = new Map<string, Partial<SuppressionShape>>();
  for (const directive of scmDirectives(scm)) {
    const match = directive.name.match(CAPTURE_DIRECTIVE);
    if (match === null) continue;
    const [capture, knob] = [match[1]!, match[2]!];
    if (knob !== "leaf" && knob !== "absorbTail") continue;
    const prior = declared.get(capture) ?? {};
    const shape: { absorbTail?: number; leaf?: boolean } = { ...prior };
    if (knob === "leaf") shape.leaf = directive.value === "true";
    else shape.absorbTail = Number(directive.value);
    declared.set(capture, shape);
  }
  return declared;
}

/** Capture name to the capture whose nodes its text leaves out. */
export function scmCaptureOmits(scm: string): ReadonlyMap<string, string> {
  return captureSettings(scm, "omit");
}

function omittedPatterns(
  scm: string,
  knob: "nameOmit" | "keyOmit" | "valueOmit",
): ReadonlyMap<string, RegExp> {
  const declared = captureSettings(scm, knob);
  return new Map([...declared].map(([capture, value]) => [capture, new RegExp(value, "gu")]));
}

export const scmNameOmits = (scm: string): ReadonlyMap<string, RegExp> =>
  omittedPatterns(scm, "nameOmit");

export const scmKeyOmits = (scm: string): ReadonlyMap<string, RegExp> =>
  omittedPatterns(scm, "keyOmit");

export const scmValueOmits = (scm: string): ReadonlyMap<string, RegExp> =>
  omittedPatterns(scm, "valueOmit");

/** Capture name to the language its text is written in. */
export const scmInjections = (scm: string): ReadonlyMap<string, string> =>
  captureSettings(scm, "injection");

export function scmCommentlessCaptures(scm: string): ReadonlySet<string> {
  const declared = [...captureSettings(scm, "ownsComments")];
  return new Set(declared.filter(([, value]) => value === "false").map(([capture]) => capture));
}

/** A .scm string's value: a backslash there escapes the next character. */
const unescaped = (text: string): string => text.replace(/\\(.)/g, "$1");

function captureSettings(scm: string, knob: string): ReadonlyMap<string, string> {
  const settings = new Map<string, string>();
  for (const directive of scmDirectives(scm)) {
    const match = directive.name.match(CAPTURE_DIRECTIVE);
    if (match === null || match[2] !== knob || directive.value === undefined) continue;
    settings.set(match[1]!, unescaped(directive.value));
  }
  return settings;
}

export function scmCaptureMerges(scm: string): ReadonlyMap<string, MergeMode> {
  const merges = new Map<string, MergeMode>();
  for (const directive of scmDirectives(scm)) {
    const match = directive.name.match(CAPTURE_DIRECTIVE);
    if (match === null || match[2] !== "merge") continue;
    merges.set(match[1]!, directive.value as MergeMode);
  }
  return merges;
}

/** Captures whose multiply-matched nodes keep their first name (per-capture naming). */
export function scmFirstNameCaptures(scm: string): ReadonlySet<string> {
  const first = new Set<string>();
  for (const directive of scmDirectives(scm)) {
    const match = directive.name.match(CAPTURE_DIRECTIVE);
    if (match === null || match[2] !== "naming" || directive.value !== "first") continue;
    first.add(match[1]!);
  }
  return first;
}

export function scmSharesSpanCaptures(scm: string): ReadonlySet<string> {
  return new Set(
    [...captureSettings(scm, "sharesSpan")]
      .filter(([, value]) => value === "true")
      .map(([capture]) => capture),
  );
}

/** Captures whose same-capture candidates nest legitimately (per-capture selfNesting). */
export function scmSelfNestingCaptures(scm: string): ReadonlySet<string> {
  const nested = new Set<string>();
  for (const directive of scmDirectives(scm)) {
    const match = directive.name.match(CAPTURE_DIRECTIVE);
    if (match === null || match[2] !== "selfNesting" || directive.value !== "true") continue;
    nested.add(match[1]!);
  }
  return nested;
}

/** Renders a definition's name; present only when a pattern binds it. */
const NAME_CAPTURE = "name";
/** Marks where a definition's body starts: its signature is the text before that node. */
const BODY_CAPTURE = "body";
const KEY_CAPTURE = "key";
const VALUE_CAPTURE = "value";
/** Captures that point at a part of an element, never an element of their own. */
const ROLE_CAPTURES: readonly string[] = [NAME_CAPTURE, BODY_CAPTURE, KEY_CAPTURE, VALUE_CAPTURE];

/** One top-level pattern of a .scm: its root node type, the captures it binds, and where it sits. */
export interface ScmPattern {
  readonly pattern: number;
  readonly rootType: string;
  readonly capture: Capture | null;
  /** Every capture name the pattern binds (capture above is the FIRST - the element capture). */
  readonly captures: readonly string[];
  /** 1-based line span of the pattern (first..last) - for messages. */
  readonly line: number;
  readonly lastLine: number;
  /** Character span (at..at+textLength) - locates attached directives EXACTLY. */
  readonly at: number;
  readonly textLength: number;
  /** True for a predicate group ((#set! ...)) - a directive's tail, never its carrier. */
  readonly textStartsPredicate: boolean;
  readonly intentional: boolean;
}

function commentEnd(scm: string, i: number): number {
  const eol = scm.indexOf("\n", i);
  return eol === -1 ? scm.length : eol;
}

/**
 * Split a .scm into its top-level patterns with a depth scanner, so each pattern's own text gives
 * its root node type and its directive. The compiled query's offsets cannot: they point at captured
 * nodes, not at pattern boundaries. A comment after a pattern's closing paren is part of that
 * pattern (a trailing `; @priority`); other comments precede the next pattern.
 */
function splitPatterns(scm: string): { text: string; precededBy: string; at: number }[] {
  const patterns: { text: string; precededBy: string; at: number }[] = [];
  let depth = 0;
  let start = -1;
  let closeAt = -1;
  let inString = false;
  let comments = "";
  let pendingComments = "";
  const flush = (tailEnd: number) => {
    if (closeAt === -1) return;
    patterns.push({
      text: scm.slice(start, Math.max(closeAt + 1, tailEnd)),
      precededBy: pendingComments,
      at: start,
    });
    start = -1;
    closeAt = -1;
    pendingComments = "";
  };
  for (let i = 0; i < scm.length; i++) {
    const char = scm[i]!;
    if (inString) {
      inString = !(char === '"' && scm[i - 1] !== "\\");
    } else if (char === '"') {
      inString = true;
    } else if (char === ";") {
      const end = commentEnd(scm, i);
      if (closeAt === -1) comments += scm.slice(i, end) + "\n";
      i = end;
    } else if (char === "(") {
      if (depth === 0) {
        flush(i);
        start = i;
        pendingComments = comments;
        comments = "";
      }
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth === 0) closeAt = i;
    } else if (depth === 0 && char.trim() !== "" && closeAt === -1) {
      comments = "";
    }
  }
  flush(scm.length);
  return patterns;
}

/**
 * Blank out string literals (single- or double-quoted, backslash-escaped) so predicates that merely
 * MENTION a word - (#match? @name "@priority") - cannot fake a directive, a capture, or a root
 * token. The quoted text is replaced by spaces, keeping offsets and line structure.
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
    if (char === '"' || char === "'") quote = char;
    commentsCut += char;
  }
  return withoutStrings(commentsCut);
}

/**
 * The file-wide directives a queries.scm may declare, with the value shape each accepts: the load-
 * time authority for names and values (the walker reads tree-sitter's parse of the same
 * directives). A name is grouper.knob and never names a node: the pattern it rides is the target.
 * presence: the name alone is the setting. The summaries are the generated directive reference.
 */
const DIRECTIVES = {
  selfNesting: {
    kind: "presence",
    summary:
      "Nested nodes of a capture become elements of their own, for every capture. The file-wide form of `capture.<name>.selfNesting`.",
  },
  "attach.gap": {
    kind: "number",
    summary:
      "Rows a comment may end above a definition and still attach to it. 1 means directly above, 2 allows one blank row, 0 attaches nothing. Default 1.",
  },
  "docstring.owner": {
    kind: "enum",
    values: ["next", "enclosing", "module"],
    summary:
      "Which definition a docstring documents: `next` is the one after it, `enclosing` is the one around it, `module` is the file itself (a header comment; a definition directly below still claims it). Default `enclosing`.",
  },
} as const;
type DirectiveName = keyof typeof DIRECTIVES;

/**
 * THE CAPTURE NAMESPACE - capture behavior as .scm data (the tier-2 authoring surface): every
 * per-capture fact the engine acts on is a `(#set! "capture.<name>.<knob>" "<value>")` line in the
 * OWNING grammar's .scm, never an engine table (the structural guard test enforces that). Naming
 * principle (the directive vocabulary's own): prefix = capture (the grouper), suffix = knob, value
 * = setting; the node type never appears.
 *
 * Knobs: `definition` (is the capture an ELEMENT - an autonomous capture MUST declare it), `leaf`
 * (a different-capture candidate strictly inside is implementation and dies), `absorbTail` (the
 * largest same-capture wrapper tail in BYTES that still reads as prefix-absorb), `selfNesting`
 * (same-capture candidates nest legitimately; the bare file-wide `selfNesting` directive remains
 * the grammar-wide form), `merge` (same-capture candidates in a run become ONE element:
 * `contiguous` - a blank line, any other source, another element, or a member that does not start
 * its row ends the run; `adjacent` - only another element ends it, so blank lines and comments ride
 * inside; `none` - every candidate is its own element), `naming` (a node one pattern matches
 * several times, each match with another name: `strict` fails the load, `first` keeps the first
 * name in the source), `omit` (the capture whose nodes are left out of this one's text), `nameOmit`
 * (the pattern left out of this one's name), `keyOmit` and `valueOmit` (the same for its key and
 * its value), `injection` (the language its text is written in), `ownsComments` (whether the
 * comments in and above it are its), `sharesSpan` (another capture's node with its span is an
 * element inside it).
 */
const CAPTURE_DIRECTIVE = new RegExp(
  `capture\\.(${CAPTURE_NAME})\\.(definition|leaf|selfNesting|absorbTail|merge|naming|omit|nameOmit|keyOmit|valueOmit|injection|ownsComments|sharesSpan)`,
);
const MERGE_MODES = ["contiguous", "adjacent", "none"] as const;
export type MergeMode = (typeof MERGE_MODES)[number];
const NAMING_MODES = ["strict", "first"] as const;
type KnobShape = "boolean" | "number" | "capture" | "regex" | "language" | readonly string[];
const CAPTURE_KNOBS: Readonly<Record<string, { shape: KnobShape; summary: string }>> = {
  definition: {
    shape: "boolean",
    summary:
      "Makes the capture an element a rule can target. Default true for function, method, class, type and binding; false for comment, import and docstring. A capture of your own must set this.",
  },
  leaf: {
    shape: "boolean",
    summary:
      "Hides every other capture inside this one, so they produce no elements. Default true for function, method and binding; false for the rest.",
  },
  selfNesting: {
    shape: "boolean",
    summary:
      "A node nested in another of the same capture becomes an element of its own. Default false.",
  },
  absorbTail: {
    shape: "number",
    summary:
      "Bytes a wrapper node may add after the capture, such as a final `;`, and still read as the same element. Default 2 for class, type and binding; otherwise 0.",
  },
  merge: {
    shape: MERGE_MODES,
    summary:
      "Joins a run of same-capture nodes into one element. `contiguous` ends the run at a blank row, at other source between two nodes, at another element, or at a node that does not start its row (so a trailing comment stays alone); `adjacent` ends it only at another element; `none` joins nothing. Default `none`; `import` defaults to `contiguous`. The embedded grammars set `comment` to `contiguous`.",
  },
  naming: {
    shape: NAMING_MODES,
    summary:
      "Settles a node that one pattern matches several times with different names, such as `int i, j;`. `strict` fails the load, `first` keeps the name that comes first in the source. Default `strict`.",
  },
  omit: {
    shape: "capture",
    summary:
      "Leaves the nodes of another capture out of this one's text, such as the `>` of a quoted line. The span does not change. Default: nothing is left out.",
  },
  nameOmit: {
    shape: "regex",
    summary:
      "Leaves what a regular expression matches out of this capture's names, such as the closing `##` of a heading. Default: nothing is left out.",
  },
  keyOmit: {
    shape: "regex",
    summary:
      "Leaves what a regular expression matches out of this capture's keys, such as the quotes around one. A pattern binds the key with `@key`. Default: nothing is left out.",
  },
  valueOmit: {
    shape: "regex",
    summary:
      "Leaves what a regular expression matches out of this capture's values, such as the quotes around a string. A pattern binds the value with `@value`. Default: nothing is left out.",
  },
  injection: {
    shape: "language",
    summary:
      "Parses this capture's text with another grammar, and captures what that grammar's queries find in it. Default: the text is not parsed again.",
  },
  sharesSpan: {
    shape: "boolean",
    summary:
      "Keeps an element of another capture that has the same span, inside this one, such as the heading line of a section with nothing under it. Default false: one span is one element.",
  },
  ownsComments: {
    shape: "boolean",
    summary:
      "Whether the comments inside this capture and directly above it are its documentation. Default true.",
  },
};

const KNOB_WANTS: Readonly<Record<Exclude<KnobShape, readonly string[]>, string>> = {
  boolean: "true or false",
  number: "a whole number",
  capture: "a capture the queries emit",
  regex: "a regular expression",
  language: "the id of a grammar",
};

const knobWants = (shape: KnobShape): string =>
  typeof shape === "string" ? KNOB_WANTS[shape] : `one of: ${shape.join(", ")}`;

function knobAccepts(
  shape: Exclude<KnobShape, "regex">,
  value: string,
  emitted: ReadonlySet<string>,
): boolean {
  if (typeof shape !== "string") return shape.includes(value);
  if (shape === "boolean") return value === "true" || value === "false";
  if (shape === "language") return /^[a-z][a-z0-9_-]*$/.test(value);
  if (shape === "number") return /^\d+$/.test(value);
  return emitted.has(value);
}

/** Throws with the reason when a knob cannot take the value. */
function assertKnobValue(
  shape: KnobShape,
  value: string | undefined,
  emitted: ReadonlySet<string>,
): void {
  if (value === undefined) throw new Error("the directive has no value");
  if (shape === "regex") new RegExp(unescaped(value), "u");
  else if (!knobAccepts(shape, value, emitted)) throw new Error(`"${value}" is not accepted`);
}

/** One row of the directive reference: the loader's vocabulary, as data. */
export interface DirectiveRow {
  readonly name: string;
  readonly values: string;
  readonly summary: string;
}

export function directiveVocabulary(): readonly DirectiveRow[] {
  const fileWide = Object.entries(DIRECTIVES).map(([name, d]) => ({
    name,
    values:
      d.kind === "presence" ? "-" : d.kind === "number" ? "a whole number" : d.values.join(" | "),
    summary: d.summary,
  }));
  const perCapture = Object.entries(CAPTURE_KNOBS).map(([knob, k]) => ({
    name: `capture.<name>.${knob}`,
    values:
      k.shape === "boolean"
        ? "true | false"
        : typeof k.shape === "string"
          ? KNOB_WANTS[k.shape]
          : k.shape.join(" | "),
    summary: k.summary,
  }));
  return [...fileWide, ...perCapture];
}

export function scmEmittedNames(scm: string): ReadonlySet<string> {
  const code = scmCode(scm);
  const named = new Set([...code.matchAll(CAPTURE_TOKEN)].map((m) => m[1]!));
  for (const role of ROLE_CAPTURES) named.delete(role);
  for (const reserved of RESERVED_CAPTURES) named.delete(reserved);
  return named;
}

/** Each emitted capture and the line that first names it. */
export function scmEmittedLines(scm: string): ReadonlyMap<string, number> {
  const emitted = scmEmittedNames(scm);
  const lines = new Map<string, number>();
  for (const [i, line] of scmCode(scm).split("\n").entries()) {
    for (const [, capture] of line.matchAll(CAPTURE_TOKEN)) {
      if (emitted.has(capture!) && !lines.has(capture!)) lines.set(capture!, i + 1);
    }
  }
  return lines;
}

/** One grammar's declared capture facts, resolved from its .scm directives. */
export interface CaptureDeclarations {
  /** Captures explicitly declared definitions ("true") - an autonomous capture's element-hood. */
  readonly definitions: ReadonlySet<string>;
  /** Captures explicitly declared NOT definitions ("false") - captured, inert, load-noted. */
  readonly inert: ReadonlySet<string>;
}

export function scmCaptureDeclarations(scm: string): CaptureDeclarations {
  const definitions = new Set<string>();
  const inert = new Set<string>();
  for (const directive of scmDirectives(scm)) {
    const match = directive.name.match(CAPTURE_DIRECTIVE);
    if (match === null || match[2] !== "definition") continue;
    if (directive.value === "true") definitions.add(match[1]!);
    else if (directive.value === "false") inert.add(match[1]!);
  }
  return { definitions, inert };
}

/** One #set! occurrence that is real syntax: outside strings, outside comments. */
interface ScmDirective {
  readonly name: string;
  /** The declared value, when the directive form carries one (#set! "name" "value"). */
  readonly value?: string;
  readonly line: number;
  /** Character offset of the # - locates the CARRYING pattern exactly. */
  readonly at: number;
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
      const setAt = i;
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
      directives.push({ name, value: valueMatch?.[1], line, at: setAt });
      if (valueMatch !== null) i += valueMatch[0]!.length;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    i++;
  }
  return directives;
}

/**
 * Directive validation at .scm load: an unknown #set! name, or a value its name does not accept, is
 * a setup error naming the line and what it wants - a directive that silently does nothing is a
 * false belief about the extraction. One name, one setting per file: the same directive twice with
 * different values fails too. Other predicates (#eq?, #match?) are tree-sitter's to check.
 */
export function assertScmDirectives(scm: string, grammarId: string): void {
  const known = Object.keys(DIRECTIVES) as DirectiveName[];
  const seen = new Map<string, { readonly value: string | undefined; readonly line: number }>();
  const emitted = scmEmittedNames(scm);
  const patterns = parseScmPatterns(scm);
  for (const directive of scmDirectives(scm)) {
    const captureKnob = directive.name.match(CAPTURE_DIRECTIVE);
    if (captureKnob !== null) {
      const capture = captureKnob[1]!;
      const knob = captureKnob[2]! as keyof typeof CAPTURE_KNOBS;
      if (!emitted.has(capture)) {
        throw new SetupError(
          "CONFIG_INVALID",
          `grammar ${grammarId} queries.scm line ${directive.line}: directive "${directive.name}" names capture '${capture}' but the queries emit no @${capture} - directive and patterns disagree`,
        );
      }
      // a directive rides the last pattern opened before it, and must name a capture that
      // pattern binds; a predicate group ((#set! ...)) carries nothing
      let carrying: ScmPattern | undefined;
      for (const p of patterns) {
        if (p.at < directive.at && !p.textStartsPredicate) carrying = p;
      }
      const bound = carrying !== undefined && carrying.captures.includes(capture);
      if (!bound) {
        throw new SetupError(
          "CONFIG_INVALID",
          `grammar ${grammarId} queries.scm line ${directive.line}: directive "${directive.name}" is on a pattern that does not bind @${capture} - move it onto a pattern that does (a directive that names one capture on another capture's pattern silently retargets)`,
        );
      }
      const shape = CAPTURE_KNOBS[knob]!.shape;
      try {
        assertKnobValue(shape, directive.value, emitted);
      } catch (cause) {
        throw new SetupError(
          "CONFIG_INVALID",
          `grammar ${grammarId} queries.scm line ${directive.line}: directive "${directive.name}" wants ${knobWants(shape)} (got ${directive.value === undefined ? "no value" : `"${directive.value}"`})`,
          { cause },
        );
      }
    } else {
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

export function scmSelfNesting(scm: string): boolean {
  return scmDirectives(scm).some((d) => d.name === "selfNesting");
}
export function parseScmPatterns(scm: string): ScmPattern[] {
  // line spans derive from CHARACTER INDICES (counting newlines before the pattern) - a running
  // counter would drift past the comment blocks between patterns
  const lineOf = (index: number): number => 1 + scm.slice(0, index).split("\n").length - 1;
  return splitPatterns(scm).map((pattern, index) => {
    const startLine = lineOf(pattern.at);
    const lastLine = startLine + pattern.text.split("\n").length - 1;
    // two views of the pattern text: strings blanked on both (a predicate string naming a
    // capture must not fake one); comments kept in `unquoted` - the directive IS a comment - and
    // cut in `code`, where only real syntax may name a root or capture
    const unquoted = withoutStrings(pattern.text);
    const code = unquoted.replace(/;.*$/gm, "");
    const rootType = (code.slice(1).split(/[\s:()]/)[0] ?? "").trim();
    const captures = [...code.matchAll(CAPTURE_TOKEN)].map((m) => m[1]!);
    const capture =
      captures.find((n) => !ROLE_CAPTURES.includes(n) && !RESERVED_CAPTURES.includes(n as never)) ??
      null;
    return {
      pattern: index,
      rootType,
      capture,
      captures,
      line: startLine,
      lastLine,
      at: pattern.at,
      textLength: pattern.text.length,
      textStartsPredicate: /^\(\s*#/.test(pattern.text),
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

/**
 * When two patterns root on the same node type but assign different element captures, the earlier
 * pattern wins, so their order is load-bearing. Every pattern in such a group must state it with an
 * `; @priority` comment: each one's position matters, not only the last one's. The check can
 * over-approximate (two patterns may share a root type yet never match the same node); stating the
 * order is the point.
 */
export function validatePatternOrder(language: string, scm: string): void {
  // An extended file (see extends.ts) states the order of each side separately: the extension's
  // patterns win over the grammar's own on purpose, and the grammar's own file is not the user's to
  // edit.
  const cut = scm.indexOf(BASE_MARKER);
  if (cut >= 0) {
    validatePatternOrder(language, scm.slice(0, cut));
    validatePatternOrder(language, scm.slice(cut + BASE_MARKER.length));
    return;
  }
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
 * Compile and fully validate one .scm against its language. Uncached: a custom query may compile
 * several .scm files against one language in a process.
 *
 * Every node type the .scm names must exist in the grammar it compiles against: an .scm written for
 * another grammar fails naming every unknown type at once, before tree-sitter's compile error
 * (which names one). The loaded language object is the authority, so embedded and custom grammars
 * get the same check.
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
      { cause: e },
    );
  }
  assertPatternCount(language, scm, query.patternCount());
  assertScmDirectives(scm, language);
  validatePatternOrder(language, scm);
  // every element capture is shared or declared by this .scm (capture.<name>.definition, true or
  // false); anything else is a misspelled shared name or a missing declaration
  const declared = scmCaptureDeclarations(scm);
  const undeclared = query.captureNames.filter(
    (name) =>
      !ROLE_CAPTURES.includes(name) &&
      !RESERVED_CAPTURES.includes(name as never) &&
      !isSharedCapture(name) &&
      !declared.definitions.has(name) &&
      !declared.inert.has(name),
  );
  if (undeclared.length > 0) {
    throw new SetupError(
      "CONFIG_INVALID",
      "query for " +
        language +
        " captures undeclared names: " +
        undeclared.join(", ") +
        " - a capture is either SHARED (" +
        SHARED_ELEMENT_CAPTURES.join(", ") +
        ') or declared by its grammar: add (#set! "capture.<name>.definition" "true") to the owning .scm',
    );
  }
  return query;
}

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
  /** Where the name node starts: the first of several names on one node is the earliest. */
  readonly nameIndex?: number;
  /** The text of the @key node. */
  readonly key?: string;
  /** The text of the @value node. */
  readonly value?: string;
  /** Where the @body node starts, when the pattern marks one: the signature ends there. */
  readonly bodyIndex?: number;
  /** The pattern's #set! values as tree-sitter parsed them, keyed by directive name. */
  readonly properties?: Readonly<Record<string, string | null>>;
}

function elementCaptureOf(match: QueryMatch, addressable: ReadonlySet<string>): Capture | null {
  for (const capture of match.captures) {
    if (addressable.has(capture.name)) {
      return capture.name;
    }
  }
  return null;
}

function candidateOf(match: QueryMatch, addressable: ReadonlySet<string>): Candidate | null {
  const capture = elementCaptureOf(match, addressable);
  if (capture === null) return null;
  const elementNode = match.captures.find((c) => c.name === capture)!.node;
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
    nameIndex: nameCaptures[0]?.node.startIndex,
    key: match.captures.find((c) => c.name === KEY_CAPTURE)?.node.text,
    value: match.captures.find((c) => c.name === VALUE_CAPTURE)?.node.text,
    bodyIndex: match.captures.find((c) => c.name === BODY_CAPTURE)?.node.startIndex,
    properties,
  };
}

function contains(outer: Candidate, inner: Candidate): boolean {
  return (
    outer.node.startIndex <= inner.node.startIndex && outer.node.endIndex >= inner.node.endIndex
  );
}

/** One element per span, and one more when its capture shares it. */
function spanKey({ node, capture }: Candidate, options: SuppressionOptions): string {
  const span = `${node.startIndex}:${node.endIndex}`;
  return options.sharesSpanCaptures.has(capture) ? `${span}:${capture}` : span;
}

const outermostFirst =
  ({ sharesSpanCaptures }: SuppressionOptions) =>
  (a: Candidate, b: Candidate): number =>
    a.node.startIndex - b.node.startIndex ||
    b.node.endIndex - a.node.endIndex ||
    Number(sharesSpanCaptures.has(b.capture)) - Number(sharesSpanCaptures.has(a.capture));

/**
 * Resolve candidate conflicts, in order: same-node double capture resolves by PATTERN ORDER (the
 * earlier .scm pattern wins - the callable-initializer refinement depends on it); then the
 * suppression policy table decides what a contained candidate is - an absorbed payload, a child of
 * its own, or implementation that dies.
 */
const NO_SUPPRESSION: SuppressionOptions = {
  shapes: new Map(),
  selfNestingCaptures: new Set(),
  sharesSpanCaptures: new Set(),
  firstNameCaptures: new Set(),
};

export function resolveCandidates(
  candidates: readonly Candidate[],
  options: SuppressionOptions = NO_SUPPRESSION,
): Candidate[] {
  const candidateBySpan = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const span = spanKey(candidate, options);
    const existing = candidateBySpan.get(span);
    // THE CONTAINER-BINDING TRAP, the multi-match half: a container pattern like
    // (enum_body (property_identifier) @name) @binding matches ONCE PER member - each match
    // carries a different member's @name onto the SAME node. One element carries one name; the
    // first match must not silently win the naming. (the one-match half is guarded where
    // candidates resolve: a single match binding @name on several nodes.)
    const renamed =
      existing !== undefined &&
      existing.pattern === candidate.pattern &&
      existing.name !== candidate.name;
    if (renamed && !options.firstNameCaptures.has(candidate.capture)) {
      throw new SetupError(
        "CONFIG_INVALID",
        "query pattern " +
          String(existing!.pattern + 1) +
          " names one node twice (" +
          [existing!.name ?? "-", candidate.name ?? "-"].join(", ") +
          ") - one element carries one name; bind @name to a single node, capture each member as its own element, or set capture." +
          candidate.capture +
          ".naming to first",
      );
    }
    const earlierName =
      renamed && (candidate.nameIndex ?? Infinity) < (existing!.nameIndex ?? Infinity);
    if (existing === undefined || candidate.pattern < existing.pattern || earlierName)
      candidateBySpan.set(span, candidate);
  }
  const ordered = [...candidateBySpan.values()].sort(outermostFirst(options));
  const kept: Candidate[] = [];
  // Candidates arrive by start, so a kept one that ended before this start contains nothing from
  // here on: only the kept candidates still open at the cursor are asked.
  const openOuters: Candidate[] = [];
  for (const candidate of ordered) {
    const start = candidate.node.startIndex;
    let swallowed = false;
    let openCount = 0;
    for (const outer of openOuters) {
      if (outer.node.endIndex < start) continue;
      openOuters[openCount++] = outer;
      if (!swallowed && hides(outer, candidate, options)) swallowed = true;
    }
    openOuters.length = openCount;
    if (swallowed) continue;
    kept.push(candidate);
    openOuters.push(candidate);
  }
  return kept;
}

/** One grammar's suppression facts: resolved per-capture shapes and the captures that nest. */
export interface SuppressionOptions {
  /** Each capture's shape: its default, overridden by the grammar's directives. */
  readonly shapes: ReadonlyMap<string, SuppressionShape>;
  /** Captures whose same-capture candidates nest legitimately. */
  readonly selfNestingCaptures: ReadonlySet<string>;
  /** Captures that hold an element of another capture whose span is their own. */
  readonly sharesSpanCaptures: ReadonlySet<string>;
  /** Captures whose node keeps its first name when one pattern matches it with several. */
  readonly firstNameCaptures: ReadonlySet<string>;
}

function shapeOf(options: SuppressionOptions, capture: string): SuppressionShape {
  return options.shapes.get(capture) ?? { absorbTail: 0, leaf: false };
}

function nestsOf(options: SuppressionOptions, capture: string): boolean {
  return options.selfNestingCaptures.has(capture);
}

export const CAPTURE_TOKEN = new RegExp(`@(${CAPTURE_NAME})`, "g");
/** Does the outer candidate hide the inner one? (policy table + .scm #set! facts; ordered) */
function hides(outer: Candidate, inner: Candidate, options: SuppressionOptions): boolean {
  // lane captures travel intact: the materializer counts them internal and keeps runs whole
  if (SHARED_LANES.has(inner.capture)) return false;
  if (!contains(outer, inner)) return false;
  if (outer.capture === inner.capture) {
    if (nestsOf(options, outer.capture)) return false;
    // a same-capture candidate that starts inside the outer's body is a member, not the outer
    // itself: a wrapper (decorator, export) starts before the body it wraps
    if (outer.bodyIndex !== undefined && inner.node.startIndex >= outer.bodyIndex) return false;
    // prefix-absorb shape: the wrapper carries at most the capture's tail tolerance (';') past
    // its payload; a larger tail is a unit of its own and surfaces as a child
    return inner.node.endIndex >= outer.node.endIndex - shapeOf(options, outer.capture).absorbTail;
  }
  return shapeOf(options, outer.capture).leaf;
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

/** A stretch of the source, by index. */
export interface Stretch {
  readonly start: number;
  readonly end: number;
}

export function runQuery(
  query: Query,
  rootNode: QueryMatchSource,
  addressable: ReadonlySet<string> = DEFAULT_ADDRESSABLE,
  /** Filled with the nodes of each capture it already names. */
  collected: ReadonlyMap<string, Stretch[]> = new Map(),
  /** Filled with every capture name a match binds. */
  matched: Set<string> = new Set(),
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const match of query.matches(rootNode as never)) {
    for (const { name, node } of match.captures) {
      matched.add(name);
      collected.get(name)?.push({ start: node.startIndex, end: node.endIndex });
    }
    const candidate = candidateOf(match, addressable);
    if (candidate !== null) candidates.push(candidate);
  }
  return candidates;
}

/** The shared lingua franca alone - a grammar's walk widens it with its declared captures. */
const DEFAULT_ADDRESSABLE: ReadonlySet<string> = new Set(SHARED_ELEMENT_CAPTURES);

export function emittedCaptures(registry: GrammarRegistry, grammarId: string): readonly string[] {
  const raw = grammar(registry, grammarId).queries;
  const named = scmEmittedNames(raw);
  const declared = scmCaptureDeclarations(raw);
  return [...named]
    .filter(
      (c) =>
        !ROLE_CAPTURES.includes(c) &&
        !RESERVED_CAPTURES.includes(c as never) &&
        (isSharedCapture(c) || declared.definitions.has(c)),
    )
    .sort();
}

const SHARED_TARGETS: ReadonlySet<string> = new Set(RULE_TARGETS);

/**
 * THE capture-address gate, run at LINT STARTUP (over the run's registry value, before any file
 * walks): a qualified address is checked against the registry the run holds - a shadow grammar
 * REPLACES its embedded extraction, so the emitted set for an id is the shadow's once merged. Two
 * distinguished failures: grammar not registered (named with the loaded ids) vs capture not emitted
 * (named with that grammar's ACTUAL emitted set - shadow-derived when a shadow exists). A bare name
 * that is neither a shared target nor an address is a typo and fails loudly too. Config load is
 * grammar-blind (no registry is built there), so an address error surfaces here as CONFIG_INVALID,
 * before anything is measured, the same way a config error does.
 */
export function assertCaptureAddress(target: string, registry: GrammarRegistry): void {
  const match = target.match(CAPTURE_ADDRESS);
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
