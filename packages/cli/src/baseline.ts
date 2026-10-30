import { domains } from "@jint/rules";
import { compileRule, registerCustomRuleLoader, type Rule } from "@jint/sdk";

/**
 * The bundled rule catalog: every domain's specs compiled through the sdk's public seam, by rule
 * name. It resolves a rule named by a bare string (the JSON tier); nothing runs unless a config
 * lists it. The sdk itself knows no rules - this module is the only place the two meet. A rule name
 * in two domains is a build-time error: names are global.
 */
export const catalog: Record<string, Rule> = (() => {
  const byName: Record<string, Rule> = {};
  const owner: Record<string, string> = {};
  for (const [domain, specs] of Object.entries(domains)) {
    for (const spec of specs) {
      if (owner[spec.name] !== undefined) {
        throw new Error(
          `rule '${spec.name}' is defined in both jint:rules/${owner[spec.name]} and jint:rules/${domain}`,
        );
      }
      owner[spec.name] = domain;
      byName[spec.name] = compileRule(spec as never, "jint:rules/" + domain);
    }
  }
  return byName;
})();

/** Registers the virtual modules: one jint:rules/<domain> per bundled domain. */
export function provideVirtualModules(): void {
  registerCustomRuleLoader({ domains });
}
