import { describe, expect, test } from "bun:test";
/**
 * The query runtime's conflict resolution, over plain structural nodes (no grammar needed):
 * same-node double capture resolves by pattern order; same-capture nesting keeps the outer;
 * different-capture overlap is legal; capture-vocabulary validation is loud.
 */
import { assertScmDirectives, scmCaptureDeclarations, scmSelfNesting } from "./query.ts";
import {
  RESERVED_CAPTURES,
  assertPatternCount,
  parseScmPatterns,
  resolveCandidates,
  validatePatternOrder,
  type Candidate,
  type QueryNode,
} from "./query.ts";

let next = 0;
function node(startIndex: number, endIndex: number): QueryNode {
  return {
    startIndex,
    endIndex,
    startPosition: { row: startIndex, column: 0 },
    endPosition: { row: endIndex, column: 0 },
    text: "n" + next++,
    type: "node",
  };
}
function candidate(
  pattern: number,
  capture: Candidate["capture"],
  start: number,
  end: number,
): Candidate {
  return { pattern, capture, node: node(start, end) };
}

describe("resolveCandidates", () => {
  test("same node, different capture: the earlier pattern wins", () => {
    const kept = resolveCandidates([
      candidate(1, "binding", 0, 10),
      candidate(0, "function", 0, 10),
    ]);
    expect(kept.map((c) => c.capture)).toEqual(["function"]);
  });

  test("same-capture absorb shape (wrapper ends with its payload): the wrapper survives", () => {
    const kept = resolveCandidates([
      candidate(1, "function", 0, 10),
      candidate(0, "function", 5, 10),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.node.startIndex).toBe(0);
  });

  test("same-capture nest that is not absorb-shaped surfaces as a child (nested functions)", () => {
    const kept = resolveCandidates([
      candidate(0, "function", 0, 20),
      candidate(1, "function", 5, 10),
    ]);
    expect(kept).toHaveLength(2);
  });

  test("a selfNesting grammar disables same-capture collapse (markdown sections)", () => {
    const kept = resolveCandidates([candidate(0, "type", 0, 20), candidate(1, "type", 5, 20)], {
      shapes: new Map(),
      selfNestingCaptures: new Set(["type"]),
    });
    expect(kept).toHaveLength(2);
  });

  test("absorb tolerance: a trailing ';' wrapper still collapses", () => {
    // type's SHARED DEFAULT shape (absorbTail 2, shared.ts) resolved as a grammar's facts would
    const kept = resolveCandidates([candidate(1, "type", 0, 10), candidate(0, "type", 0, 12)], {
      shapes: new Map([["type", { absorbTail: 2, opaque: false }]]),
      selfNestingCaptures: new Set(),
    });
    expect(kept).toHaveLength(1);
  });

  test("different-capture overlap is legal", () => {
    const kept = resolveCandidates([candidate(0, "type", 0, 20), candidate(1, "function", 5, 10)]);
    expect(kept).toHaveLength(2);
  });

  test("siblings never suppress each other", () => {
    const kept = resolveCandidates([
      candidate(0, "function", 0, 5),
      candidate(0, "function", 10, 15),
    ]);
    expect(kept).toHaveLength(2);
  });
});

describe("validatePatternOrder", () => {
  const conflict = (captures: [string, string], directives: [boolean, boolean]) =>
    [
      `(foo_declaration) @${captures[0]}${directives[0] ? " ; @priority" : ""}`,
      `(foo_declaration) @${captures[1]}${directives[1] ? " ; @priority" : ""}`,
      "",
    ].join("\n");

  test("an unstated same-root different-capture pair fails", () => {
    expect(() =>
      validatePatternOrder("probe", conflict(["function", "binding"], [false, false])),
    ).toThrow(/probe: patterns .*foo_declaration/);
  });

  test("the boundary is per pattern: one directive does not cover the pair", () => {
    expect(() =>
      validatePatternOrder("probe", conflict(["function", "binding"], [false, true])),
    ).toThrow(/pattern 0: @function \(unstated\)/);
  });

  test("both patterns stated passes", () => {
    expect(() =>
      validatePatternOrder("probe", conflict(["function", "binding"], [true, true])),
    ).not.toThrow();
  });

  test("same capture on one root is not a conflict", () => {
    expect(() =>
      validatePatternOrder("probe", conflict(["type", "type"], [false, false])),
    ).not.toThrow();
  });

  test("a multi-line pattern's root is its own head node, not a continuation token", () => {
    const scm =
      "(long_declaration\n  name: (identifier) @name) @function\n(long_declaration) @binding\n";
    expect(() => validatePatternOrder("probe", scm)).toThrow(
      /root at node type "long_declaration"/,
    );
  });

  test("a predicate string mentioning @priority does NOT fake the directive", () => {
    // the only @priority occurrences are inside (#match? ...) strings: both patterns are
    // unstated, so the pair must still fail - raw-text regexing would have passed it
    const scm =
      '(foo_declaration\n  (#match? @name "@priority")) @function\n' +
      '(foo_declaration\n  (#match? @name "@priority")) @binding\n';
    expect(() => validatePatternOrder("probe", scm)).toThrow(/\(unstated\)/);
  });

  test("a real directive beside a predicate string still states the pair", () => {
    const scm =
      '(foo_declaration\n  (#match? @name "@priority")) @function ; @priority\n' +
      '(foo_declaration\n  (#match? @name "@priority")) @binding ; @priority\n';
    expect(() => validatePatternOrder("probe", scm)).not.toThrow();
  });

  test("a string literal cannot fake a capture name either", () => {
    const parsed = parseScmPatterns(
      '(foo_declaration\n  (#eq? @name "@binding")) @function ; @priority\n',
    );
    expect(parsed[0]!.capture).toBe("function");
  });

  test("the reserved @test token validates but emits nothing", () => {
    // reserved names are valid captures: validation accepts them, no grammar assigns one yet
    expect(RESERVED_CAPTURES).toContain("test");
    const scm = "(function_declaration) @test ; @priority\n(function_declaration) @function\n";
    const parsed = parseScmPatterns(scm);
    expect(parsed[0]!.intentional).toBe(true);
    // @test is not an element capture, so the pattern reads as nameless rather than as an element
    expect(parsed[0]!.capture).toBeNull();
  });

  test("the parsed pattern count must equal the compiled count", () => {
    const scm = ["(foo_declaration) @function", "(bar_declaration) @binding", ""].join("\n");
    expect(() => assertPatternCount("probe", scm, 2)).not.toThrow();
    expect(() => assertPatternCount("probe", scm, 3)).toThrow(
      /probe: parsed 2 pattern\(s\) from queries.scm but the grammar compiled 3/,
    );
  });

  test("a preceding comment line carries the directive too", () => {
    const scm =
      "; @priority: deliberate order\n(bar_declaration) @function\n(bar_declaration) @binding ; @priority\n";
    expect(() => validatePatternOrder("probe", scm)).not.toThrow();
  });
});

describe("THE VOCABULARY CHAIN (single source, exhaustively pinned)", () => {});
describe("scm directive reading (the shared .scm discipline)", () => {
  test("a real directive is found; trailing comments and predicate strings cannot fake it", () => {
    expect(scmSelfNesting('((section) @section (#set! "selfNesting"))')).toBe(true);
    // trailing comment: prose, not a directive
    expect(scmSelfNesting('(paragraph) @paragraph ; #set! "selfNesting"')).toBe(false);
    // predicate string: a mention, not a directive
    expect(scmSelfNesting('(#match? @x "#set! \"selfNesting\"")')).toBe(false);
  });

  test("malformed or unknown #set forms are loud, naming the line", () => {
    expect(() => assertScmDirectives('(a) @a #set "x"', "g")).toThrow(/#set" is malformed/);
    expect(() => assertScmDirectives("(a) @a #set!", "g")).toThrow(
      /missing its quoted directive name/,
    );
    expect(() => assertScmDirectives('(a) @a (#set! "nesting")', "g")).toThrow(
      /unknown directive \"nesting\"/,
    );
    // no throw: known directive, and unknown predicate forms stay tree-sitter's business
    expect(() =>
      assertScmDirectives('(a) @a (#eq? @x "y") (#set! "selfNesting")', "g"),
    ).not.toThrow();
  });

  // THE CAPTURE NAMESPACE (tier-2 authoring surface): capture.<name>.<knob> directives carry
  // per-capture behavior; validation is kind-checked and emitted-honest
  test("capture directives: valid knobs pass, wrong kinds and unemitted captures fail loud", () => {
    // directive helper: one #set! with a quoted name and value
    const D = (name: string, value: string): string => `(#set! "${name}" "${value}")`;
    const scm =
      "(x) @chunk " +
      D("capture.chunk.definition", "true") +
      " " +
      "(y) @fn " +
      D("capture.fn.absorbTail", "2");
    expect(() => assertScmDirectives(scm, "g")).not.toThrow();
    expect(() =>
      assertScmDirectives("(x) @chunk " + D("capture.chunk.nonsense", "true"), "g"),
    ).toThrow(/unknown directive/);
    expect(() =>
      assertScmDirectives("(x) @chunk " + D("capture.chunk.absorbTail", "true"), "g"),
    ).toThrow(/wants a whole number/);
    expect(() => assertScmDirectives("(x) @chunk " + D("capture.chunk.opaque", "2"), "g")).toThrow(
      /wants true or false/,
    );
    expect(() =>
      assertScmDirectives("(x) @chunk " + D("capture.ghost.definition", "true"), "g"),
    ).toThrow(/emit no @ghost - directive and patterns disagree/);
  });

  test("a capture directive riding a pattern that binds a DIFFERENT capture is loud", () => {
    const D = (name: string, value: string): string => `(#set! "${name}" "${value}")`;
    // @chunk's directive attached to the @lane pattern (@chunk IS emitted, by the later
    // pattern): a silent retarget the emitted check alone cannot catch
    const scm = "(x) @lane " + D("capture.chunk.definition", "true") + " (y) @chunk";
    expect(() => assertScmDirectives(scm, "g")).toThrow(
      /rides a pattern that does not bind @chunk - attach it to a pattern that does/,
    );
    // the same directive, riding ITS OWN pattern, passes
    const ok = "(x) @chunk " + D("capture.chunk.definition", "true") + " (y) @lane";
    expect(() => assertScmDirectives(ok, "g")).not.toThrow();
  });

  test("scmCaptureDeclarations resolves definition true/false from the directives", () => {
    const D = (name: string, value: string): string => `(#set! "${name}" "${value}")`;
    const scm =
      "(x) @chunk " +
      D("capture.chunk.definition", "true") +
      " " +
      "(y) @lane " +
      D("capture.lane.definition", "false");
    const declared = scmCaptureDeclarations(scm);
    expect([...declared.definitions]).toEqual(["chunk"]);
    expect([...declared.inert]).toEqual(["lane"]);
  });

  expect(() => assertScmDirectives('(a) @a (#set! "attach.gap" "0")', "g")).not.toThrow();
  test("values are read and typed loudly: number, enum, presence-only", () => {
    // dotted names parse; each value shape says what it wants when wrong
    expect(() => assertScmDirectives('(a) @a (#set! "attach.gap" "0")', "g")).not.toThrow();
    expect(() => assertScmDirectives('(a) @a (#set! "attach.gap" "2")', "g")).not.toThrow();
    expect(() => assertScmDirectives('(a) @a (#set! "attach.gap" "zero")', "g")).toThrow(
      /attach\.gap wants a whole number \(got "zero"\)/,
    );
    expect(() => assertScmDirectives('(a) @a (#set! "docstring.owner" "next")', "g")).not.toThrow();
    expect(() => assertScmDirectives('(a) @a (#set! "docstring.owner" "sideways")', "g")).toThrow(
      /docstring\.owner wants one of: next, enclosing \(got "sideways"\)/,
    );
    expect(() => assertScmDirectives('(a) @a (#set! "docstring.owner")', "g")).toThrow(
      /docstring\.owner wants one of: next, enclosing \(got no value\)/,
    );
    expect(() => assertScmDirectives('(a) @a (#set! "import.merge" "file")', "g")).toThrow(
      /import\.merge wants one of: contiguous, none \(got "file"\)/,
    );
    expect(() => assertScmDirectives('(a) @a (#set! "selfNesting" "true")', "g")).toThrow(
      /selfNesting is presence-only - it takes no value \(got "true"\)/,
    );
  });

  test("one name, one setting: the same directive twice with different values is loud", () => {
    expect(() =>
      assertScmDirectives('(a) @a (#set! "attach.gap" "0")\n(b) @b (#set! "attach.gap" "2")', "g"),
    ).toThrow(/directive "attach\.gap" is set twice with different values \(line 1 set "0"\)/);
    // agreeing declarations are fine, and so is the same directive on several patterns
    expect(() =>
      assertScmDirectives('(a) @a (#set! "attach.gap" "2")\n(b) @b (#set! "attach.gap" "2")', "g"),
    ).not.toThrow();
  });
});
