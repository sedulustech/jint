import { defineConfig } from "oxfmt";

export default defineConfig({
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
