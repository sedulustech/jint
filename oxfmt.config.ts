import { defineConfig } from "oxfmt";

export default defineConfig({
  // probes/ is archived probe data (fixtures are deliberately defective; configs are
  // historical snapshots) - format-checked source stays out of the archive. The issue-021
  // fixtures are deliberately truncated code cuts (unclosed braces) - unformattable by design.
  ignorePatterns: [
    "probes/**",
    "tests/fixtures/statements-grammar/**",
    // generated from the defaults specs by `bun run schema` - the generator owns the format
    "docs/rules.mdx",
  ],
  jsdoc: true,
  sortImports: {
    ignoreCase: true,
    newlinesBetween: false,
    order: "asc",
    groups: [
      "value-builtin",
      "value-external",
      ["value-parent", "value-sibling", "value-index"],
      "unknown",
    ],
  },
});
