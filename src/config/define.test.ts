import { describe, test, expect } from "bun:test";
import { defaultRules } from "../core/sensors/defaults.ts";
import { defineConfig } from "./define.ts";
import type { Rule } from "../core/types.ts";

describe("defineConfig", () => {
  test("defaults spread + disable removes rules by name (set membership)", () => {
    const config = defineConfig({
      input: "src/",
      rules: { ...defaultRules, disable: ["will_comment_drift"] },
      exclude: [],
    });
    const names = config.rules.map((s) => s.name);
    expect(names).toHaveLength(9);
    expect(names).not.toContain("will_comment_drift");
  });

  test("re-declaring a rule by name overrides the default (last wins)", () => {
    const overridden: Rule = { ...defaultRules.is_name_purposeful!, handle: () => "error" };
    const config = defineConfig({
      input: "src/",
      rules: { ...defaultRules, is_name_purposeful: overridden, disable: [] },
    });
    const rule = config.rules.find((s) => s.name === "is_name_purposeful");
    expect(rule?.handle(0.9)).toBe("error");
  });

  test("plain array form is accepted", () => {
    const rule: Rule = {
      name: "custom",
      criteria: { true: "when the claim holds", false: "otherwise" },
      target: "files",
      handle: () => null,
    };
    const config = defineConfig({ input: "a.ts", rules: [rule] });
    expect(config.rules).toEqual([rule]);
  });

  test("resolved config is frozen data", () => {
    const config = defineConfig({ input: "src/", rules: { ...defaultRules, disable: [] } });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.rules)).toBe(true);
  });

  test("exclude and inputType round-trip", () => {
    const config = defineConfig({ input: "x.patch", inputType: "diff", exclude: ["*.lock"] });
    expect(config.inputType).toBe("diff");
    expect(config.exclude).toEqual(["*.lock"]);
  });

  test("default rules all declare a valid target", () => {
    const targets = new Set(["files", "functions", "definitions", "comments", "imports", "diffs"]);
    for (const rule of Object.values(defaultRules)) {
      expect(targets.has(rule.target)).toBe(true);
    }
  });
});
