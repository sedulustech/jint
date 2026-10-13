import { describe, expect, test } from "bun:test";
import { headCell, PATH_WIDTH, row, RULE_WIDTH, SEVERITY_WIDTH, tailCell } from "./format.ts";

describe("tailCell (right-aligned, keeps the tail)", () => {
  test("short cells pad-start to the width", () => {
    expect(tailCell("src/a.ts", 10)).toBe("  src/a.ts");
    expect(tailCell("a.ts", 10).length).toBe(10);
  });
  test("exact-width cells pass through", () => {
    expect(tailCell("0123456789", 10)).toBe("0123456789");
  });
  test("overflow keeps the tail and marks the cut with one ellipsis", () => {
    expect(tailCell("packages/sdk/src/core/types.ts", 12)).toBe(".../types.ts");
    expect(tailCell("abcdefghij", 7)).toBe("...ghij");
  });
  test("the ellipsis always means dropped characters - never decorative", () => {
    const out = tailCell("a-very-long-path/indeed.ts", 12);
    expect(out.startsWith("...")).toBe(true);
    expect(out.length).toBe(12);
    expect(out.endsWith("path/indeed.ts")).toBe(false); // the cut is real: the full text would not fit
  });
  test("degenerate widths degrade without throwing", () => {
    expect(tailCell("abcdef", 3)).toBe("def");
    expect(tailCell("abcdef", 0)).toBe("");
  });
});

describe("headCell (left-aligned, keeps the head)", () => {
  test("short cells pad-end to the width", () => {
    expect(headCell("warn", 5)).toBe("warn ");
    expect(headCell("is_greppable", RULE_WIDTH).length).toBe(RULE_WIDTH);
  });
  test("overflow keeps the head and marks the cut", () => {
    expect(headCell("is_comment_patching_readability_x", RULE_WIDTH)).toBe(
      "is_comment_patching_readabil...",
    );
  });
  test("the longest default rule name fits without truncation", () => {
    expect(headCell("is_comment_patching_readability", RULE_WIDTH)).toBe(
      "is_comment_patching_readability",
    );
  });
});

describe("row", () => {
  test("joins cells with exactly two spaces", () => {
    expect(row("a", "b")).toBe("a  b");
    expect(row("a", "b", "c", "d")).toBe("a  b  c  d");
  });
});

describe("column grammar invariants (cross-run stability)", () => {
  test("a finding line's columns sit at fixed offsets for every width of content", () => {
    const short = row(
      tailCell("a.ts@L1", PATH_WIDTH),
      headCell("is_greppable", RULE_WIDTH),
      headCell("warn", SEVERITY_WIDTH),
      "0.50",
    );
    const long = row(
      tailCell("packages/sdk/src/core/input/walk.ts@L751", PATH_WIDTH),
      headCell("is_comment_patching_readability", RULE_WIDTH),
      headCell("error", SEVERITY_WIDTH),
      "10.00",
    );
    // the rule column starts at the same offset in both lines - alignment is a format property
    expect(short.indexOf("is_greppable")).toBe(long.indexOf("is_comment_patching_readability"));
    expect(short.indexOf("warn")).toBe(long.indexOf("error"));
    // severity column offset: PATH_WIDTH + 2 + RULE_WIDTH + 2
    expect(short.indexOf("warn")).toBe(PATH_WIDTH + 2 + RULE_WIDTH + 2);
  });
});
