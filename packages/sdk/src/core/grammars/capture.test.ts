import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture } from "./capture.ts";
import { resetGrammarsForTest } from "./grammars.ts";
import { resetQueriesForTest } from "./query.ts";

// a shadow replaces a grammar's .scm: the compiled-query cache is per language and must drop
// with the registry, or the shadow would extract with the embedded .scm
afterEach(() => {
  resetGrammarsForTest();
  resetQueriesForTest();
});

const MARKDOWN = ["# Head\n", "\n", "prose body\n"].join("");

/** A scratch workspace with the given files; returns its dir. */
function scratch(name: string, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "jint-capture-" + name + "-"));
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content);
  }
  return dir;
}

/** A grammar dir for a NON-embedded id with a junk wasm: registration must fail the cross-check. */
function badCrossCheckDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "jint-capture-badwasm-"));
  mkdirSync(join(dir, "notmarkdown"), { recursive: true });
  writeFileSync(join(dir, "notmarkdown", "queries.scm"), "(paragraph) @section\n");
  writeFileSync(join(dir, "notmarkdown", "extensions.json"), JSON.stringify([".md"]));
  // a junk wasm: registration must reach the export cross-check and fail it loudly
  writeFileSync(join(dir, "notmarkdown", "notmarkdown.wasm"), "not a wasm");
  // the id comes from the LEAF dir name: hand over the grammar dir itself
  return join(dir, "notmarkdown");
}

describe("capture (verb) - extraction with the classifier unplugged", () => {
  test("a dir input yields elements carrying input + grammar attribution", async () => {
    const dir = scratch("dir", { "a.md": MARKDOWN, "b.md": "## Only\n\ntext\n" });
    const elements = await capture(dir);
    expect(elements.length).toBeGreaterThanOrEqual(3);
    const inputs = new Set(elements.map((e) => e.input));
    // input is the walk's path form: relative to the input root (as lint reports it)
    expect(inputs).toEqual(new Set(["a.md", "b.md"]));
    for (const e of elements) {
      expect(e.grammar).toBe("markdown");
      expect(e.span.start.line).toBeGreaterThan(0);
    }
    const sections = elements.filter((e) => e.kind === "section");
    expect(sections).toHaveLength(2);
  });

  test("queryPath replaces the embedded .scm: the iterate-on-a-known-language loop", async () => {
    const dir = scratch("query", { "doc.md": MARKDOWN });
    const file = join(dir, "doc.md");
    const wip = join(dir, "wip.scm");
    // the WIP query inverts the embedded mapping: paragraphs are the section elements
    writeFileSync(wip, "(paragraph) @section\n");
    const embedded = await capture(file);
    expect(embedded.some((e) => e.kind === "section" && e.name === "Head")).toBe(true);
    const overridden = await capture(file, wip);
    expect(overridden.map((e) => e.kind)).toEqual(["section"]);
    // attribution still holds
    for (const e of overridden) expect(e.grammar).toBe("markdown");
  });

  test("an invalid .scm override is LOUD: vocabulary, pattern-order conflict, compile", async () => {
    const dir = scratch("badscm", { "doc.md": MARKDOWN, "wip.scm": "(paragraph) @bogus\n" });
    expect(capture(join(dir, "doc.md"), join(dir, "wip.scm"))).rejects.toThrow(
      /captures outside the vocabulary/,
    );
    // two patterns sharing one root node type with different captures: the order between them
    // is load-bearing, the missing "; @priority" is the loud error
    writeFileSync(join(dir, "bad.scm"), "(paragraph) @section\n(paragraph) @paragraph\n");
    expect(capture(join(dir, "doc.md"), join(dir, "bad.scm"))).rejects.toThrow(/@priority/);
    writeFileSync(join(dir, "unk.scm"), "(no_such_node_type) @section\n");
    expect(capture(join(dir, "doc.md"), join(dir, "unk.scm"))).rejects.toThrow(
      /query compilation failed/,
    );
  });

  test("grammarPath registers ad hoc: the shadow dir governs extraction for this call", async () => {
    const dir = scratch("adhoc", { "doc.md": MARKDOWN });
    const shadow = join(
      new URL("../../../../../tests/fixtures/grammars", import.meta.url).pathname,
      "markdown",
    );
    const elements = await capture(join(dir, "doc.md"), undefined, shadow);
    // the shadow .scm assigns @section to paragraph nodes: the prose run is the only element
    expect(elements).toHaveLength(1);
    expect(elements[0]!.kind).toBe("section");
    // the paragraph node, not the heading section the embedded .scm would give
    expect(elements[0]!.span.start.line).toBe(3);
    // a FILE input carries the path as given (the walk form for dirs is root-relative)
    expect(elements[0]!.input).toBe(join(dir, "doc.md"));
    expect(elements[0]!.grammar).toBe("markdown");
  });

  test("queryPath WINS over the grammar dir's own queries.scm; the dir is still validated", async () => {
    const dir = scratch("both", { "doc.md": MARKDOWN, "mine.scm": "(paragraph) @paragraph\n" });
    const shadow = join(
      new URL("../../../../../tests/fixtures/grammars", import.meta.url).pathname,
      "markdown",
    );
    // MY .scm governs extraction (the shadow's section-only set is ignored); the query file is
    // the extraction source, and the grammar dir still had to pass routing + wasm validation
    const elements = await capture(join(dir, "doc.md"), join(dir, "mine.scm"), shadow);
    expect(elements.map((e) => e.kind)).toEqual(["paragraph"]);
  });

  test("a grammar dir whose wasm export disagrees with the dir name is a LOUD setup failure", () => {
    const dir = scratch("input", { "doc.md": MARKDOWN });
    expect(capture(join(dir, "doc.md"), undefined, badCrossCheckDir())).rejects.toThrow(
      /is not a valid wasm module/,
    );
  });

  test("an extension no registered grammar claims is a loud routing error", () => {
    const _dir = scratch("route", { "doc.rst": "title\n=====\n\nbody\n" });
    expect(capture(join(_dir, "doc.rst"))).rejects.toThrow(/missing grammar/);
  });

  test("a query file that does not exist is a loud setup error", () => {
    const dir = scratch("missing", { "doc.md": MARKDOWN });
    expect(capture(join(dir, "doc.md"), join(dir, "nope.scm"))).rejects.toThrow(/unreadable/);
  });

  test("ad-hoc registration does not survive as an installed grammar for other ids", async () => {
    // nothing installed: after the resets, the registry is back to the embedded set
    const dir = scratch("scope", { "doc.md": MARKDOWN });
    const shadow = join(
      new URL("../../../../../tests/fixtures/grammars", import.meta.url).pathname,
      "markdown",
    );
    await capture(join(dir, "doc.md"), undefined, shadow);
    resetGrammarsForTest();
    resetQueriesForTest();
    // embedded .scm again: the section carries its heading name, not the shadow's inversion
    const elements = await capture(join(dir, "doc.md"));
    expect(elements.some((e) => e.kind === "section" && e.name === "Head")).toBe(true);
  });

  test("a mixed-grammar dir yields elements from BOTH grammars, attribution exact", async () => {
    const dir = scratch("mixed", {
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
