import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetGrammarsForTest } from "../packages/sdk/src/core/grammars/grammars.ts";
import { resetQueriesForTest } from "../packages/sdk/src/core/grammars/query.ts";
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
  // the custom-grammar test registers a shadow grammar in-process; without the reset it
  // governs every LATER capture in this file (embedded-behavior tests would use the shadow)
  resetGrammarsForTest();
  resetQueriesForTest();
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

  test("capture(file, undefined, grammarDir): custom BYOG - the shadow dir governs extraction", async () => {
    const dir = setup("custom", { "doc.md": DOC });
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
    // routing: no registered grammar claims .rst (the SDK truth, naming extensions.json)
    expect(capture(join(dir, "doc.rst"))).rejects.toThrow(
      /no loaded grammar claims the extension of .*doc\.rst - routing comes from/,
    );
  });

  test("a dir with files no grammar claims succeeds: elements from the claimable, one event per skip", async () => {
    const dir = setup("sweep", {
      "a.md": DOC,
      "data.json": '{"a":1}\n',
      Makefile: "all:\n\techo hi\n",
    });
    const skips: { file: string; extension: string }[] = [];
    const elements = await capture(dir, undefined, undefined, (skip) => skips.push(skip));
    // the walk survived the strays; every element comes from the claimable file
    expect(new Set(elements.map((e) => e.input))).toEqual(new Set(["a.md"]));
    // ONE raw event per skipped file (walk order: Makefile sorts before lowercase names):
    // file + extension token, no aggregate, no parsed list
    expect(skips).toEqual([
      { file: "Makefile", extension: "(extensionless)" },
      { file: "data.json", extension: ".json" },
    ]);
  });

  test("a foreign grammar's queries.scm is a loud cross-grammar rejection (colliding vocabulary)", () => {
    // css's mapping is comments-only: its node types all exist in typescript, so the vocabulary
    // guard passes and the silent mis-extraction is the danger - the identity guard rejects it
    const cssScm = join(
      import.meta.dir,
      "..",
      "packages",
      "sdk",
      "src",
      "core",
      "grammars",
      "embedded",
      "css",
      "queries.scm",
    );
    const dir = setup("cross", { "code.ts": "// one comment\nfunction f() {}\n" });
    expect(capture(join(dir, "code.ts"), cssScm)).rejects.toThrow(
      /is the queries\.scm of css - it maps css nodes, not typescript/,
    );
  });

  test("a mixed-grammar dir yields elements from BOTH grammars, attribution exact", async () => {
    const dir = setup("mixed", {
      "doc.md": DOC,
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

  test("text: the span-sliced source, truncated at 200 chars with one ellipsis", async () => {
    const dir = setup("text", {
      "doc.md": DOC,
      // one paragraph well past the cap: truncation must cap at 200 + the single ellipsis char
      "long.md": "# Long\n\n" + "p".repeat(500) + "\n",
    });
    // EXACT: text is the file sliced by the element's span bytes
    const file = join(dir, "doc.md");
    const bytes = await Bun.file(file).text();
    const paragraph = (await capture(file)).find((e) => e.kind === "paragraph")!;
    expect(paragraph.text).toBe(bytes.slice(paragraph.span.startByte, paragraph.span.endByte));
    // TRUNCATION: a >200-char element caps at 200 chars plus the single ellipsis character, and
    // the capped prefix is the span slice - the span stays the authority for the full content
    const longFile = join(dir, "long.md");
    const longBytes = await Bun.file(longFile).text();
    const long = (await capture(longFile)).find((e) => e.span.endByte - e.span.startByte > 200)!;
    expect(long.text.length).toBe(201);
    expect(long.text.endsWith("\u2026")).toBe(true);
    expect(long.text.slice(0, 200)).toBe(
      longBytes.slice(long.span.startByte, long.span.startByte + 200),
    );
  });
});
