import { defineConfig } from "oxfmt";

export default defineConfig({
  // probes/ is archived probe data (fixtures are deliberately defective; configs are
  // historical snapshots) - format-checked source stays out of the archive.
  // The grammar shape corpora (<language>-shapes.<ext>) are synthetic source written the odd ways
  // each grammar must parse; formatting them would erase the shapes. Their tests stay checked.
  ignorePatterns: [
    "probes/**",
    "packages/sdk/src/core/grammars/*-shapes.{ts,tsx,json,css,toml,yaml}",
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
