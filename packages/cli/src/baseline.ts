import { defaultRules as defaultSpecs } from "@jint/defaults";
import { compileRule, registerCustomRuleLoader, type Rule } from "@jint/sdk";

/**
 * The bundled baseline: the defaults package's specs compiled through the sdk's public seam. The
 * sdk itself knows no rules — this module is the only place the two meet, and the only one that
 * names the rules. A new defaults version bumps this package, never the sdk.
 */
export const defaultRules: Record<string, Rule> = Object.fromEntries(
  defaultSpecs.map((spec) => {
    const rule = compileRule(spec as never, "@jint/defaults");
    return [rule.name, rule];
  }),
);

/** The built-in config used when no config file exists: no input, the bundled baseline. */
export function defaultConfig() {
  return Object.freeze({
    input: "",
    rules: Object.freeze(Object.values(defaultRules)),
    customRules: Object.freeze([]),
    include: Object.freeze([]),
    exclude: Object.freeze(["**/fixtures/**"]),
  });
}

/** Registers the virtual modules with the bundled defaults as the jint:defaults provider. */
export function provideVirtualModules(): void {
  registerCustomRuleLoader({ defaults: defaultSpecs });
}
