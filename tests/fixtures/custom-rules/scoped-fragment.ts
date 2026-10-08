import { is_greppable } from "jint:defaults";
/**
 * Real custom-rule file for the scoping tests: a fragment whose include/exclude is the default
 * scope for its rules, with a rule declaring its own scope (wholesale replacement) and a callback
 * rule (inheritance, callback lane). Load it with loadCustomRules("tests/fixtures/...").
 */
import { defineConfig } from "jint:sdk";

export default defineConfig({
  // fragment-level scope: these rules never measure test files
  exclude: ["**/*.test.ts"],
  rules: [
    // inherits the fragment scope as-is
    is_greppable,
    // declares its own scope: replaces the fragment scope wholesale (measures src/ only,
    // test files included)
    { ...is_greppable, name: "is_greppable_src", include: ["src/**"] },
    // callback rule, no scope of its own: inherits the fragment scope (callback lane)
    {
      name: "will_comment_explain_domain",
      target: "comments",
      classify: (self) => ({
        instructions:
          "Judge whether the comment explains a domain concept or business rule that the code " +
          "alone does not reveal. Comments that narrate what the next line obviously does, or " +
          "paraphrase the code, are not domain explanations.",
        criteria: {
          true:
            "The comment carries domain knowledge: a business rule, an invariant, a reason " +
            "rooted outside the code, or context a newcomer could not reconstruct from the code.",
          false:
            "The comment restates the code, narrates the obvious, or documents nothing the " +
            "reader could not tell from the code itself.",
        },
        state: { source: self.source },
      }),
      handle: {
        warn: { greater_than: 0.9 },
      },
    },
  ],
});
