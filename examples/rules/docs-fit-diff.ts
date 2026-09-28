/**
 * Docs-fit-diff — the doc-drift SEED rule: the ctx.diff lens enables it. Given ctx.diff (populated
 * by the changed-file list: jint - / --changed), this rule judges each changed code element against
 * the question of whether the change keeps documented claims true.
 *
 * The lens is KNOWLEDGE ABOUT the judged things: a rule that never reads ctx.diff is untouched by
 * its presence; this one reads it. Without a list the policy answers silent, so the rule is safe in
 * any run. LOUD on a defined-but-empty lens: a list that resolves to zero walked elements means the
 * intersection misfired — never read as "docs untouched".
 *
 * Scope note (the seed boundary): .md files have no tree-sitter grammar, so a doc itself cannot yet
 * be a TS-rule target — the judged subject here is the changed code. Making docs first-class judged
 * subjects (with the change CONTENT, which jint does not parse — the caller's diff is their own
 * input via jint str -) is the follow-on feature; this seed pins the lens mechanics.
 */

import { defineConfig } from "jint:sdk";

/** The .md files in the run's changed list. */
function changedDocs(paths: readonly string[]): readonly string[] {
  return paths.filter((p) => p.endsWith(".md"));
}

export default defineConfig({
  rules: [
    {
      name: "is_doc_fit",
      target: "definitions",
      classify: (self, ctx) => ({
        instructions:
          "Judge whether the code change keeps the documentation true. " +
          "True means: the doc's claims survive this change. False means: this change makes " +
          "statements in the doc untrue (renamed API, changed behavior, removed guarantee).",
        criteria: {
          true: "the doc's statements remain true after this change",
          false: "this change invalidates a statement the doc makes",
        },
        state: {
          element: self.source,
          changed: ctx.diff !== undefined ? ctx.diff.paths.join(", ") : "",
        },
      }),
      handleClassification: (results, ctx) =>
        results.map((r, i) => {
          // no list: nothing to know
          if (ctx.diff === undefined) return { severity: null };
          // LOUD on a defined-but-empty lens (never silence): the list resolved to zero walked
          // elements — a changed-list path not under the walked root, or all entries missing.
          if (ctx.diff.file.length === 0) {
            return i === 0
              ? {
                  severity: "warn",
                  message:
                    "ctx.diff is empty - the changed list matched no walked element " +
                    "(list paths are relative to the input dir, or absolute)",
                }
              : { severity: null };
          }
          const docChanged = changedDocs(ctx.diff.paths).length > 0;
          // No docs in the changed set: nothing can drift — silent regardless of the reading.
          if (!docChanged) return { severity: null };
          return {
            severity: r.type === "noul" && r.noul < 0.5 ? "warn" : null,
            message: "this change may contradict the documentation (docs are in the changed set)",
          };
        }),
    },
  ],
});
