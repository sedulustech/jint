import type { CustomElement, CustomRule } from "jint:sdk";

const declarationsOf = (elements: readonly CustomElement[]) =>
  elements.filter((e) => e.parent === null && e.name !== undefined);

/** The declarations a rule names, and the ones those name. */
function usedBy(rule: CustomElement, declarations: readonly CustomElement[]): CustomElement[] {
  const used = new Set([rule]);
  for (const user of used)
    for (const d of declarations) if (user.source.includes(d.name!)) used.add(d);
  used.delete(rule);
  return [...used];
}

/**
 * A capture retrieves, and a rule's state composes. Measured on 11 bindings: the 4 that extract
 * with a regular expression or a slice read 0.01 to 0.38, and the 7 that extract nothing 0.88 to
 * 1.00.
 */
export const no_programmatic_capture: CustomRule = {
  name: "no_programmatic_capture",
  target: (elements) =>
    elements.filter((e) => e.capture === "binding" && e.signature?.includes(": CustomRule")),
  include: ["**/jint.config.ts", "**/*.jint.ts", "web/rules/**"],
  instructions:
    "rule is one lint rule, and helpers is the code it uses. A capture is a piece of a file that a grammar's queries extract. Does the rule, with its helpers, take every piece of text from a capture instead of extracting it in code?",
  criteria: {
    true: "The rule extracts nothing itself. It reads an element's own fields (source, name, value, signature, parent), picks elements by their capture or name, and joins, trims or renames what it picked. A rule with no function extracts nothing.",
    false:
      "The rule, or a helper it uses, extracts a piece of text from a larger one in code: a regular expression match, a slice or substring by offsets, a split into lines or fields, or a parser.",
  },
  state: (rule, { file }) => ({
    rule: rule.source,
    helpers: usedBy(rule, declarationsOf(file.elements()))
      .map((e) => e.source)
      .join("\n\n"),
  }),
  handle: {
    error: {
      less_than: 0.5,
      message:
        "Capture the text in the grammar's queries.scm, and compose the state from captures.",
    },
  },
};
