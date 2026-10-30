import { allRules as allSpecs } from "@jint/rules";
import { compileRule } from "../src/config/load.ts";
import type { Rule } from "../src/core/types.ts";

/**
 * The compiled rule catalog for tests: the specs compiled through the public seam, exactly as the
 * CLI's baseline compiles them. Test-time only — the sdk source itself knows no rules.
 */
export const catalog: Record<string, Rule> = Object.fromEntries(
  allSpecs.map((spec) => {
    const rule = compileRule(spec as never, "@jint/rules");
    return [rule.name, rule];
  }),
);

/** A config carrying every catalog rule - the shape a config naming all rules resolves to. */
export function catalogConfig() {
  return Object.freeze({
    input: "",
    rules: Object.freeze(Object.values(catalog)),
    customRules: Object.freeze([]),
    exclude: Object.freeze(["**/fixtures/**"]),
  });
}
