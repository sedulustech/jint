/**
 * THE POLLUTION PROOF, committed (2026-10-19, registry encapsulation): ONE process, one custom
 * registration, then the SDK scopes WITHOUT the custom dir - asserting the custom grammar is
 * ABSENT. The old module-level registry failed this three separate times in test history (a
 * capture's grammarPath overlay governed every later call); the per-call registry value makes the
 * leak impossible by construction. Proven in three observable forms:
 *
 * 1. Extraction: a later capture() extracts with the EMBEDDED .scm, not the shadow's
 * 2. Routing: an extension only the custom grammar claimed is unclaimed by a later call
 * 3. Validation: a later lint()'s capture-address gate accepts an address only the EMBEDDED grammar
 *    satisfies (the shadow's emitted set would reject it)
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capture, lint, collectReport, loadConfig } from "../packages/sdk/src/index.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";

const SHADOW = join(import.meta.dir, "fixtures", "grammars", "markdown");
const EMBEDDED_MD_WASM = join(
  import.meta.dir,
  "..",
  "packages",
  "sdk",
  "src",
  "core",
  "grammars",
  "embedded",
  "markdown",
  "markdown.wasm",
);
const ROOT = scratchDir("jint-registry-isolation");

afterAll(() => {
  rmScratchTree(ROOT);
});

const DOC = ["# Title", "", "first paragraph", "", "## Sub", "", "second paragraph", ""].join("\n");

function setup(name: string, files: Record<string, string>): string {
  const dir = join(ROOT, name);
  rmScratchTree(dir);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content);
  }
  return dir;
}

describe("custom registration is a value per call - the impossible leak", () => {
  test("extraction: capture() AFTER a custom-grammar call extracts with the EMBEDDED .scm", async () => {
    const dir = setup("extraction", { "doc.md": DOC });
    const file = join(dir, "doc.md");
    // the custom call: the shadow governs ITS walk (paragraphs as sections - the inverted mapping)
    const shadowed = await capture(file, undefined, SHADOW);
    expect(shadowed.map((e) => e.span.start.line).sort()).toEqual([3, 7]);
    // the next call, custom dir absent: heading sections with names, paragraphs as paragraphs
    const after = await capture(file);
    expect(after.filter((e) => e.kind === "section").map((e) => e.name)).toEqual(["Title", "Sub"]);
    expect(after.filter((e) => e.kind === "paragraph")).toHaveLength(2);
  });

  test("routing: an extension only the custom grammar claimed is unclaimed after the call", async () => {
    const dir = setup("routing", { "doc.md": DOC, "note.mylang": DOC });
    // a scratch grammar dir named markdown (the wasm cross-check owns the id, so the id must be
    // markdown to reuse the embedded wasm) claiming .mylang - an extension the embedded set does
    // not claim
    const custom = join(dir, "grammars", "markdown");
    mkdirSync(custom, { recursive: true });
    cpSync(EMBEDDED_MD_WASM, join(custom, "markdown.wasm"));
    writeFileSync(join(custom, "extensions.json"), JSON.stringify([".md", ".mylang"]));
    writeFileSync(
      join(custom, "queries.scm"),
      '(paragraph) @section (#set! "capture.section.definition" "true")\n',
    );
    // the custom call: .mylang routes and extracts
    const claimed = await capture(join(dir, "note.mylang"), undefined, custom);
    expect(claimed.length).toBeGreaterThan(0);
    // the next call, custom dir absent: no grammar claims .mylang - the routing died with the call
    await expect(capture(join(dir, "note.mylang"))).rejects.toThrow(
      /no loaded grammar claims the extension of .*note\.mylang/,
    );
  });

  test("validation: lint() AFTER a custom-grammar call accepts an embedded-only address", async () => {
    const dir = setup("gate", { "doc.md": DOC });
    const file = join(dir, "doc.md");
    // the custom call first (same process): markdown:paragraph is INVALID under the shadow's
    // emitted set - if the registration leaked, the lint below would die at its address gate
    await capture(file, undefined, SHADOW);
    writeFileSync(
      join(dir, "jint.config.json"),
      JSON.stringify({
        input: "doc.md",
        apiKey: "test-key",
        rules: [
          {
            name: "prose_probe",
            target: "markdown:paragraph",
            instructions: "Judge the unit.",
            criteria: { true: "t", false: "f" },
            handle: { warn: { greater_than: 0.5 } },
          },
        ],
      }),
    );
    const config = await loadConfig(join(dir, "jint.config.json"));
    // a classifier stub keeps the run off the network; the run COMPLETING is the assertion - the
    // address gate read the run's own registry (embedded base: paragraph is emitted), not the
    // leak of an earlier call
    const report = await collectReport(
      lint({ config, input: file, classifier: async () => ({}) as never }),
    );
    expect(report.measurements).toBeDefined();
  });
});
