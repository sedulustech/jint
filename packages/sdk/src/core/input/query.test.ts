/**
 * The query runtime's conflict resolution, over plain structural nodes (no grammar needed):
 * same-node double capture resolves by pattern order; same-capture nesting keeps the outer;
 * different-capture overlap is legal; capture-vocabulary validation is loud.
 */
import { describe, expect, test } from "bun:test";
import { resolveCandidates, type Candidate, type QueryNode } from "./query.ts";

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

  test("same capture nested in the same capture: the outer survives", () => {
    const kept = resolveCandidates([
      candidate(0, "function", 0, 20),
      candidate(1, "function", 5, 10),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.node.startIndex).toBe(0);
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
