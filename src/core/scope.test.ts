import { describe, expect, test } from "bun:test";
import { checkRuleScope, compileRuleScope, ruleInScope, ruleMeasuresNothing } from "./scope.ts";

describe("checkRuleScope", () => {
  test("valid shapes pass", () => {
    expect(checkRuleScope({})).toBeNull();
    expect(checkRuleScope({ include: ["src/**"] })).toBeNull();
    expect(checkRuleScope({ exclude: ["tests/**", "**/*.spec.ts"] })).toBeNull();
    expect(checkRuleScope({ include: ["a"], exclude: ["a"] })).toBeNull();
  });

  test("each failure names the exact field", () => {
    expect(checkRuleScope({ include: [] })).toMatch(/include: must be a non-empty array/);
    expect(checkRuleScope({ exclude: [] })).toMatch(/exclude: must be a non-empty array/);
    expect(checkRuleScope({ include: ["ok", ""] })).toMatch(
      /include: every entry must be a non-empty glob string/,
    );
    expect(checkRuleScope({ exclude: [42 as never] })).toMatch(
      /exclude: every entry must be a non-empty glob string/,
    );
    // negation decision: rejected, naming the field (the global exclude silently ignores it)
    expect(checkRuleScope({ include: ["!tests/**"] })).toMatch(
      /include: negated globs .!pattern. are not supported/,
    );
    expect(checkRuleScope({ exclude: ["!src/**"] })).toMatch(
      /exclude: negated globs .!pattern. are not supported/,
    );
  });
});

describe("compileRuleScope / ruleInScope — the scoping matrix", () => {
  const matches = (keys: Parameters<typeof compileRuleScope>[0], path: string): boolean =>
    compileRuleScope(keys)?.matches(path) ?? true;

  test("neither key: the rule applies everywhere", () => {
    expect(matches({}, "src/a.ts")).toBe(true);
    expect(matches({}, "tests/a.spec.ts")).toBe(true);
  });

  test("include only: absent include is everything, present include filters to the glob", () => {
    expect(matches({ include: ["src/**"] }, "src/a.ts")).toBe(true);
    expect(matches({ include: ["src/**"] }, "tests/a.ts")).toBe(false);
  });

  test("exclude only: everything except the glob", () => {
    expect(matches({ exclude: ["tests/**"] }, "src/a.ts")).toBe(true);
    expect(matches({ exclude: ["tests/**"] }, "tests/a.ts")).toBe(false);
  });

  test("both: include filters first, exclude subtracts last — exclude always wins", () => {
    const keys = { include: ["src/**"], exclude: ["src/generated/**"] };
    expect(matches(keys, "src/a.ts")).toBe(true);
    expect(matches(keys, "src/generated/out.ts")).toBe(false);
    // the SAME pattern in both lists: exclude wins, the rule measures nothing there
    const both = { include: ["src/**"], exclude: ["src/**"] };
    expect(matches(both, "src/a.ts")).toBe(false);
    expect(ruleMeasuresNothing(both)).toBe(true);
    // overlapping-but-not-equal globs stay legal and do not read as cancelled
    expect(ruleMeasuresNothing({ include: ["src/**"], exclude: ["src/generated/**"] })).toBe(false);
  });

  test("glob semantics match the global exclude: bare names are **/-prefixed, slashed patterns anchor", () => {
    // a bare name matches a path ENDING in it at any depth; it is not a directory prune
    expect(matches({ exclude: ["more.ts"] }, "sub/more.ts")).toBe(false);
    expect(matches({ exclude: ["more.ts"] }, "sub/other.ts")).toBe(true);
    // a slashed pattern anchors EXACTLY: subtree scoping uses the dir/** form
    expect(matches({ exclude: ["tests/spec"] }, "tests/spec")).toBe(false);
    expect(matches({ exclude: ["tests/spec"] }, "tests/spec/a.ts")).toBe(true);
    expect(matches({ exclude: ["tests/spec/**"] }, "tests/spec/a.ts")).toBe(false);
    expect(matches({ exclude: ["tests/spec/**"] }, "a/tests/spec/a.ts")).toBe(true); // anchored
  });

  test("ruleInScope compiles once per rule object and defaults to true when unscoped", () => {
    const unscoped = {} as const;
    expect(ruleInScope(unscoped, "anywhere/at/all.ts")).toBe(true);
    const scoped = { include: ["src/**"] } as const;
    expect(ruleInScope(scoped, "src/a.ts")).toBe(true);
    expect(ruleInScope(scoped, "tests/a.ts")).toBe(false);
  });
});
