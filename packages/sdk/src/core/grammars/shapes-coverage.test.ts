import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

/**
 * THE completeness guard for the shape corpora: every capture a grammar's queries.scm declares as
 * an element must have at least one row in that language's INVENTORY (<language>-shapes.test.ts). A
 * newly supported capture with no shape row fails here by language and capture name, so a grammar
 * cannot grow an element nobody pinned.
 *
 * The rows are read from the test sources, not imported: importing a test file would register its
 * tests a second time here.
 */

const GRAMMARS = new URL("./embedded/", import.meta.url).pathname;
const HERE = new URL("./", import.meta.url).pathname;

// role and marker captures name parts of an element or order patterns; they are never elements
const ROLE_CAPTURES: ReadonlySet<string> = new Set(["name", "key", "value", "body", "priority"]);

// a docstring is projected as a comment element (shared.ts SHARED_PROJECTION)
const KIND_OF: Readonly<Record<string, string>> = { docstring: "comment" };

// a language's inventory lives in <language>-shapes.test.ts; markdown's frontmatter capture cannot
// share markdown-shapes.md (it must open the file), so its row lives with the frontmatter fixture
const INVENTORY_FILES: Readonly<Record<string, readonly string[]>> = {
  markdown: ["markdown-shapes.test.ts", "markdown-frontmatter.test.ts"],
};

const languages = readdirSync(GRAMMARS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

/** The scm without its ; comments (a ; inside a "string" is part of the string). */
function withoutComments(scm: string): string {
  let out = "";
  let inString = false;
  let inComment = false;
  for (let i = 0; i < scm.length; i++) {
    const ch = scm[i] ?? "";
    if (inComment) {
      if (ch === "\n") {
        inComment = false;
        out += ch;
      }
    } else if (inString) {
      out += ch;
      if (ch === "\\") out += scm[++i] ?? "";
      else if (ch === '"') inString = false;
    } else if (ch === ";") {
      inComment = true;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

/** The element kinds a grammar's queries.scm can emit. */
function declaredKinds(language: string): Set<string> {
  const scm = withoutComments(readFileSync(GRAMMARS + language + "/queries.scm", "utf8"));
  const kinds = new Set<string>();
  for (const match of scm.matchAll(/@([A-Za-z_][A-Za-z0-9_.-]*)/g)) {
    const capture = match[1] ?? "";
    // a capture declared no element (definition "false") has no row to pin
    if (scm.includes(`"capture.${capture}.definition" "false"`)) continue;
    if (!ROLE_CAPTURES.has(capture)) kinds.add(KIND_OF[capture] ?? capture);
  }
  return kinds;
}

/** The kinds a file of the language can hold: its grammar's, and those of the grammars it injects. */
function kindsInside(language: string): Set<string> {
  const scm = withoutComments(readFileSync(GRAMMARS + language + "/queries.scm", "utf8"));
  const injected = [...scm.matchAll(/"capture\.\w+\.injection" "(\w+)"/g)].map((m) => m[1]!);
  return new Set([language, ...injected].flatMap((id) => [...declaredKinds(id)]));
}

/** The kinds of the intended rows in a language's INVENTORY tables (a row's own `kind:` line). */
function inventoryKinds(language: string): Set<string> {
  const files = INVENTORY_FILES[language] ?? [language + "-shapes.test.ts"];
  const kinds = new Set<string>();
  for (const file of files) {
    const source = readFileSync(HERE + file, "utf8");
    const start = source.indexOf("const INVENTORY");
    const end = source.indexOf("\n];", start);
    for (const m of source
      .slice(start, end)
      .matchAll(/^(?: {2}\{ (?:id: "[^"]*", )?| {4})kind: "([\w.]+)"/gm)) {
      kinds.add(m[1] ?? "");
    }
  }
  return kinds;
}

describe("shape corpora cover every element capture of every grammar", () => {
  test("every embedded grammar is found", () => {
    expect(languages).toEqual([
      "bash",
      "c",
      "cpp",
      "css",
      "go",
      "json",
      "markdown",
      "php",
      "python",
      "query",
      "toml",
      "tsx",
      "typescript",
      "yaml",
    ]);
  });

  for (const language of languages) {
    test(language + ": every element capture has an inventory row", () => {
      const declared = declaredKinds(language);
      expect(declared.size, language + " declares at least one element capture").toBeGreaterThan(0);
      const pinned = inventoryKinds(language);
      expect(
        [...declared].filter((kind) => !pinned.has(kind)).sort(),
        language + ": captures with no shape row",
      ).toEqual([]);
    });

    test(language + ": no inventory row names a kind the grammar no longer emits", () => {
      const declared = kindsInside(language);
      expect(
        [...inventoryKinds(language)].filter((kind) => !declared.has(kind)).sort(),
        language + ": rows with no capture",
      ).toEqual([]);
    });
  }
});
