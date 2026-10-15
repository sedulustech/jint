/**
 * The query runtime's conflict resolution, over plain structural nodes (no grammar needed):
 * same-node double capture resolves by pattern order; same-capture nesting keeps the outer;
 * different-capture overlap is legal; capture-vocabulary validation is loud.
 */
import { describe, expect, test } from "bun:test";
import {
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
      selfNesting: true,
    });
    expect(kept).toHaveLength(2);
  });

  test("absorb tolerance: a trailing ';' wrapper still collapses", () => {
    const kept = resolveCandidates([candidate(1, "type", 0, 10), candidate(0, "type", 0, 12)]);
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
    ).toThrow(/probe: patterns .*foo_declaration.*load-bearing/);
  });

  test("the boundary is per pattern: one directive does not cover the pair", () => {
    expect(() =>
      validatePatternOrder("probe", conflict(["function", "binding"], [false, true])),
    ).toThrow(/pattern 0: @function on foo_declaration \(unstated\)/);
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
    expect(() => validatePatternOrder("probe", scm)).toThrow(/root node type "long_declaration"/);
  });

  test("a preceding comment line carries the directive too", () => {
    const scm =
      "; @priority: deliberate order\n(bar_declaration) @function\n(bar_declaration) @binding ; @priority\n";
    expect(() => validatePatternOrder("probe", scm)).not.toThrow();
  });
});
