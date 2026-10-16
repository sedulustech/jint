import { describe, expect, test } from "bun:test";
import { defaultRules } from "@jint/defaults";
import { matchesTarget } from "../rules/classify.ts";
import type { WalkElement } from "../input/walk.ts";

// THE DEFAULTS-IDENTICAL PIN (owner decision: defaults rewritten as explicit target lists with
// identical behavior). Every default that used to say target: "definitions" now says the
// five-capture union; this test proves the two forms measure the SAME set on an inventory that
// spans every definition capture, so the rewrite is provably a no-op for the measured set.

describe("defaults targets: the union is identical to the definitions shorthand", () => {
  const inventory: WalkElement[] = [
    {
      label: "f",
      span: span(),
      content: "f",
      nodeType: "f",
      capture: "function",
      docstringCount: 0,
      internalCommentCount: 0,
    },
    {
      label: "c",
      span: span(),
      content: "c",
      nodeType: "c",
      capture: "class",
      docstringCount: 0,
      internalCommentCount: 0,
    },
    {
      label: "m",
      span: span(),
      content: "m",
      nodeType: "m",
      capture: "method",
      docstringCount: 0,
      internalCommentCount: 0,
    },
    {
      label: "t",
      span: span(),
      content: "t",
      nodeType: "t",
      capture: "type",
      docstringCount: 0,
      internalCommentCount: 0,
    },
    {
      label: "b",
      span: span(),
      content: "b",
      nodeType: "b",
      capture: "binding",
      docstringCount: 0,
      internalCommentCount: 0,
    },
    {
      label: "x",
      span: span(),
      content: "x",
      nodeType: "x",
      capture: "comment",
      internalCommentCount: 0,
      docstringCount: 0,
    },
    {
      label: "i",
      span: span(),
      content: "i",
      nodeType: "i",
      capture: "import",
      internalCommentCount: 0,
      docstringCount: 0,
    },
  ];

  test("every rewritten default carries the exact five-capture union", () => {
    const rewritten = defaultRules.filter((r) => Array.isArray(r.target));
    expect(rewritten.length).toBeGreaterThanOrEqual(3);
    for (const rule of rewritten) {
      expect(rule.target, rule.name).toEqual([
        "functions",
        "classes",
        "methods",
        "types",
        "bindings",
      ]);
    }
  });

  test("the union measures the same elements the definitions shorthand measures", () => {
    for (const rule of defaultRules) {
      if (!Array.isArray(rule.target)) continue;
      for (const element of inventory) {
        const union = rule.target.some((t) => matchesTarget(t, element));
        expect(union, rule.name + " on " + element.label).toBe(
          matchesTarget("definitions", element),
        );
      }
    }
  });

  test("no default rule still uses the definitions shorthand", () => {
    for (const rule of defaultRules) {
      expect(rule.target === "definitions", rule.name).toBe(false);
    }
  });
});

function span() {
  return {
    start: { line: 1, column: 0 },
    end: { line: 1, column: 1 },
    startByte: 0,
    endByte: 1,
  };
}
