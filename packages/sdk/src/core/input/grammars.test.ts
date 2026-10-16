/**
 * The grammar-dir seam: user registration over the new layout (grammar id = DIRECTORY name; the
 * three artifacts are <id>.wasm, queries.scm, extensions.json - there is no manifest), and the loud
 * failures that keep a typo from parsing into silence.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knownLanguages, loadUserGrammars, resetGrammarsForTest } from "./grammars.ts";

/** A scratch grammar root; `dirs` maps grammar-dir name -> artifact name -> content. */
function scratchDir(dirs: Record<string, Record<string, string | Uint8Array>>): string {
  const root = mkdtempSync(join(tmpdir(), "jint-grammars-"));
  for (const [name, files] of Object.entries(dirs)) {
    mkdirSync(join(root, name), { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      writeFileSync(join(root, name, file), content as string);
    }
  }
  return root;
}

const EXT = JSON.stringify([".xyz"]);
const SCM = "(function_declaration name: (identifier) @name) @function\n";

/**
 * The real embedded markdown wasm (a genuine tree_sitter_markdown export): valid only under a dir
 * named markdown - which is exactly what the copy-paste guard pins.
 */
let WASM_BYTES: Uint8Array | undefined;
async function wasm(): Promise<Uint8Array> {
  WASM_BYTES ??= new Uint8Array(
    await Bun.file(new URL("./embedded/markdown/markdown.wasm", import.meta.url)).arrayBuffer(),
  );
  return WASM_BYTES;
}

async function markdownDir(
  id: string,
): Promise<Record<string, Record<string, string | Uint8Array>>> {
  return {
    [id]: {
      "extensions.json": EXT,
      "queries.scm": SCM,
      [id + ".wasm"]: await wasm(),
    },
  };
}

// The grammar scan memoizes per process, and bun runs the suite's files in one process: reset
// BEFORE and after each test so a parallel file's lint run can never satisfy this one.
beforeEach(() => {
  resetGrammarsForTest();
});
afterEach(() => {
  resetGrammarsForTest();
});

describe("loadUserGrammars", () => {
  test("the minimal three-artifact dir registers; the id is the DIRECTORY name", async () => {
    const dir = scratchDir(await markdownDir("markdown"));
    await loadUserGrammars(dir);
    expect(knownLanguages()).toContain("markdown");
  });

  test("a dir without queries.scm is a setup error naming the missing extraction half", async () => {
    const dir = scratchDir({ python: { "extensions.json": EXT } });
    await expect(loadUserGrammars(dir)).rejects.toThrow(/queries\.scm is missing/);
  });

  test("a dir without extensions.json is a setup error naming the routing artifact", async () => {
    const dir = scratchDir({ python: { "queries.scm": SCM } });
    await expect(loadUserGrammars(dir)).rejects.toThrow(/extensions\.json is missing/);
  });

  test("malformed extensions.json shapes are loud: not an array, empty, or not dot-prefixed", async () => {
    const cases = [
      JSON.stringify({ ext: [".x"] }),
      JSON.stringify([]),
      JSON.stringify(["x"]),
    ] as const;
    for (const ext of cases) {
      const dir = scratchDir({
        markdown: {
          "extensions.json": ext,
          "queries.scm": SCM,
          "markdown.wasm": await wasm(),
        },
      });
      await expect(loadUserGrammars(dir)).rejects.toThrow(/invalid extensions\.json/);
      resetGrammarsForTest();
    }
  });

  test("THE COPY-PASTE GUARD: a wasm whose export disagrees with the dir name errors naming both", async () => {
    const dir = scratchDir(await markdownDir("notmarkdown"));
    await expect(loadUserGrammars(dir)).rejects.toThrow(
      /grammar dir "notmarkdown" holds a wasm whose language function is "tree_sitter_markdown"/,
    );
  });

  test("a wasm that exports no tree_sitter_* function is rejected (not a grammar wasm)", async () => {
    const dir = scratchDir({
      probe: { "extensions.json": EXT, "queries.scm": SCM, "probe.wasm": "not a real wasm" },
    });
    await expect(loadUserGrammars(dir)).rejects.toThrow(/is not a valid wasm module/);
  });
});

describe("one grammar per dir", () => {
  test("each subdirectory is one grammar; a second dir holding the wrong wasm trips the guard", async () => {
    const dir = scratchDir({ ...(await markdownDir("markdown")), ...(await markdownDir("other")) });
    // "other" holds the markdown wasm - the copy-paste guard fires on the second registration
    await expect(loadUserGrammars(dir)).rejects.toThrow(/holds a wasm whose language function/);
  });

  test("a loose file at the grammar-dir root yields one coverage note, not silence", async () => {
    const dir = scratchDir(await markdownDir("markdown"));
    writeFileSync(join(dir, "probe.manifest.json"), '{ "stale": true }');
    const notes: string[] = [];
    await loadUserGrammars(dir, (note) => notes.push(note));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("loose file(s) (probe.manifest.json) ignored");
    expect(knownLanguages()).toContain("markdown");
  });
});
