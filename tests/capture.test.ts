import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capture } from "../packages/sdk/src/index.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";

// capture() end-to-end over the PUBLIC sdk surface (index.ts): the four call shapes and the loud
// failures. The registration mechanics and the validator are unit-tested beside the source
// (packages/sdk/src/core/grammars/capture.test.ts); this file proves the exported surface
// observably, over real files, following the byog-markdown.test.ts harness conventions.

const ROOT = scratchDir("jint-capture-e2e");
const SHADOW = join(import.meta.dir, "fixtures", "grammars");

afterEach(() => {
  rmScratchTree(ROOT);
});

/** One run dir with the given files; returns the dir. */
function setup(name: string, files: Record<string, string>): string {
  const dir = join(ROOT, name);
  rmScratchTree(dir);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content);
  }
  return dir;
}

const DOC = ["# Title", "", "first paragraph", "", "## Sub", "", "second paragraph", ""].join("\n");

describe("capture() e2e — the exported sdk surface", () => {
  test("a dir input yields attributed elements: input + grammar on every element", async () => {
    const dir = setup("dir", { "a.md": DOC, "b.md": "## Only\n\ntext\n" });
    const elements = await capture(dir);
    expect(elements.length).toBeGreaterThanOrEqual(4);
    expect(new Set(elements.map((e) => e.input))).toEqual(new Set(["a.md", "b.md"]));
    for (const e of elements) expect(e.grammar).toBe("markdown");
    // the embedded .scm: heading sections carry their heading text as the name
    expect(elements.filter((e) => e.kind === "section").map((e) => e.name)).toContain("Title");
  });

  test("capture(file, wip.scm): the query override drives extraction against an embedded grammar", async () => {
    const dir = setup("query", { "doc.md": DOC, "wip.scm": "(paragraph) @section\n" });
    const file = join(dir, "doc.md");
    const elements = await capture(file, join(dir, "wip.scm"));
    // the WIP .scm makes the two prose runs the section elements - not the heading sections
    expect(elements.map((e) => e.span.start.line).sort()).toEqual([3, 7]);
    expect(elements.every((e) => e.kind === "section")).toBe(true);
    for (const e of elements) {
      expect(e.input).toBe(file);
      expect(e.grammar).toBe("markdown");
    }
  });

  test("capture(file, undefined, grammarDir): ad-hoc BYOG - the shadow dir governs extraction", async () => {
    const dir = setup("adhoc", { "doc.md": DOC });
    const elements = await capture(join(dir, "doc.md"), undefined, join(SHADOW, "markdown"));
    // the shadow .scm assigns @section to paragraph nodes: the two prose runs, nothing else
    expect(elements.map((e) => e.span.start.line).sort()).toEqual([3, 7]);
    expect(elements.every((e) => e.grammar === "markdown")).toBe(true);
  });

  test("loud failures: bad wasm cross-check, invalid .scm, unroutable extension", async () => {
    const dir = setup("loud", {
      "doc.md": DOC,
      "doc.rst": "title\n=====\n\nbody\n",
      "wip.scm": "(paragraph) @bogus\n",
    });
    // the junk grammar dir lives in the scratch tree - never inside the repo fixtures
    const bad = join(dir, "grammars", "notmarkdown");
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, "queries.scm"), "(paragraph) @section\n");
    writeFileSync(join(bad, "extensions.json"), JSON.stringify([".md"]));
    writeFileSync(join(bad, "notmarkdown.wasm"), "not a wasm");
    // the wasm cross-check: the export must agree with the directory name
    expect(capture(join(dir, "doc.md"), undefined, bad)).rejects.toThrow(
      /is not a valid wasm module/,
    );
    // the .scm goes through the full loud compile checks - a capture outside the vocabulary fails
    expect(capture(join(dir, "doc.md"), join(dir, "wip.scm"))).rejects.toThrow(
      /captures outside the vocabulary/,
    );
    // routing: no registered grammar claims .rst
    expect(capture(join(dir, "doc.rst"))).rejects.toThrow(/missing grammar/);
  });

  test("a mixed-grammar dir yields elements from BOTH grammars, attribution exact", async () => {
    const dir = setup("mixed", {
      "doc.md": MARKDOWN,
      "code.ts": "function hello() {}\n",
    });
    const elements = await capture(dir);
    // the grammar set is exactly the two routed grammars - no third kind of attribution
    expect(new Set(elements.map((e) => e.grammar))).toEqual(new Set(["markdown", "typescript"]));
    // per-element attribution matches the input file's extension
    for (const e of elements) {
      expect(e.grammar).toBe(e.input.endsWith(".md") ? "markdown" : "typescript");
    }
    const md = elements.filter((e) => e.grammar === "markdown");
    const ts = elements.filter((e) => e.grammar === "typescript");
    expect(md.every((e) => e.kind === "section" || e.kind === "paragraph")).toBe(true);
    expect(ts.map((e) => e.kind)).toContain("function");
    expect(ts.every((e) => e.input.endsWith(".ts"))).toBe(true);
  });
});
