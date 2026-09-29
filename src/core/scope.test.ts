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
    expect(checkRuleScope({ include: ["pass", ""] })).toMatch(
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

  // Review 396888e finding 2: reusing compilePattern without dirOnly made "tests/" match NOTHING
  // in a rule scope while the global exclude pruned the whole tree. Same pattern, same meaning,
  // every context — dirOnly matches when any ANCESTOR directory satisfies the pattern.
  test("dirOnly (trailing-slash) patterns scope out the whole subtree, like the global exclude", () => {
    expect(matches({ exclude: ["tests/"] }, "tests/a.ts")).toBe(false);
    expect(matches({ exclude: ["tests/"] }, "tests/deep/b.ts")).toBe(false);
    // a stripped trailing slash makes the pattern bare, so ANY dir named tests matches — the
    // global exclude prunes those directories identically (parity test below proves it)
    expect(matches({ exclude: ["tests/"] }, "src/tests/a.ts")).toBe(false);
    // and in an include list: "tests/" scopes the rule INTO the subtree only
    expect(matches({ include: ["tests/"] }, "tests/a.ts")).toBe(true);
    expect(matches({ include: ["tests/"] }, "tests/deep/b.ts")).toBe(true);
    expect(matches({ include: ["tests/"] }, "src/a.ts")).toBe(false);
  });

  test("same-pattern-same-behavior parity: rule scope == global exclude walk semantics", async () => {
    // Behavioral, not just regex-level: the ground truth is what walkDir's global exclude
    // actually yields. The full file listing of the fixture is what a rule scope sees; whatever
    // the walk prunes, the scope must exclude, for all four pattern shapes.
    const { mkdirSync, rmSync, writeFileSync } = await import("node:fs");
    const { walkDir } = await import("./input/dir.ts");
    const dir = "tests/fixtures/scope-parity-fs";
    mkdirSync(`${dir}/tests/nested`, { recursive: true });
    mkdirSync(`${dir}/src/a`, { recursive: true });
    const files = [
      "keep.ts",
      "tests/spec.ts",
      "tests/nested/deep.ts",
      "src/mod.test.ts",
      "src/a/b.ts",
    ];
    for (const f of files) writeFileSync(`${dir}/${f}`, "export const x = 1;\n");
    try {
      for (const pattern of ["tests/", "tests/**", "*.test.ts", "src/a/b.ts"]) {
        const walked: string[] = [];
        for await (const unit of walkDir(dir, [pattern])) {
          if (unit.kind === "file") walked.push(unit.state.path);
        }
        const scope = compileRuleScope({ exclude: [pattern] });
        const expected = files.filter((f) => scope!.matches(f));
        expect(new Set(walked), `exclude: ${pattern}`).toEqual(new Set(expected));
        // mirrored through an include list: the rule applies to exactly what the walk kept
        const includeScope = compileRuleScope({ include: [pattern] });
        const included = files.filter((f) => includeScope!.matches(f));
        expect(included, `include: ${pattern}`).toEqual(
          files.filter((f) => !new Set(walked).has(f)),
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The documented trap (review 396888e finding 6): a file input's path is matched AS GIVEN, and
  // scope patterns are root-relative (no leading slash, like the global exclude), so an absolute
  // input path can never satisfy a relative glob and the rule silently applies. Pinned so a
  // change to that decision is deliberate, not accidental.
  test("file-input paths match as-given: an absolute path defeats a relative glob", () => {
    expect(ruleInScope({ exclude: ["tests/**"] }, "/repo/tests/a.ts")).toBe(true);
  });
});
