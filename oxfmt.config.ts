import { defineConfig } from "oxfmt";

export default defineConfig({
  // probes/ is archived probe data (fixtures are deliberately defective; configs are
  // historical snapshots) - format-checked source stays out of the archive.
  ignorePatterns: ["probes/**"],
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
