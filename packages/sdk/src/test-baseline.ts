import { defaultRuleSpecs } from "@jint/defaults";
import { compileRule } from "./config/load.ts";
import type { Rule } from "./core/types.ts";

/**
 * The compiled default baseline for tests: the specs compiled through the public seam, exactly as
 * the CLI's baseline compiles them. Test-time only — the sdk source itself knows no rules.
 */
export const defaultRules: Record<string, Rule> = Object.fromEntries(
  Object.values(defaultRuleSpecs).map((spec) => {
    const rule = compileRule(spec as never, "@jint/defaults");
    return [rule.name, rule];
  }),
);

/** The configless config carrying the baseline — what the CLI's no-config path uses. */
export function defaultConfig() {
  return Object.freeze({
    input: "",
    rules: Object.freeze(Object.values(defaultRules)),
    customRules: Object.freeze([]),
    exclude: Object.freeze(["**/fixtures/**"]),
  });
}
