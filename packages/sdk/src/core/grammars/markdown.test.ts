/**
 * The markdown port: sections (self-nesting via the .scm's #set! "selfNesting" directive) and
 * paragraphs (flat - no directive, paragraphs never nest) are the two md-only element captures;
 * every retired stretch is a WAITING in embedded/markdown/queries.scm.
 */
import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

describe("decompose — markdown", () => {
  test("a pipe table is one element, whole: header, delimiter and every row", async () => {
    const table = "| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |";
    const inv = await decompose(`# T\n\nintro\n\n${table}\n\n| c |\n| - |\n| 5 |\n`, "markdown");
    const tables = inv.definitions.filter((d) => d.capture === "table");
    expect(tables.map((t) => t.content.trim())).toEqual([table, "| c |\n| - |\n| 5 |"]);
    expect(tables.every((t) => t.parent === "d0")).toBe(true);
  });

  test("sections capture with their heading text and nest inside each other", async () => {
    const inv = await decompose("# A\n\ntext\n\n## B\n\nmore\n\n# C\n\ntail\n", "markdown");
    const sections = inv.definitions.filter((d) => d.capture === "section");
    expect(sections.map((d) => [d.name, d.parent])).toEqual([
      ["A", undefined],
      ["B", "d0"],
      ["C", undefined],
    ]);
  });

  test("paragraphs capture flat: children of their section, never parents (no #set! directive)", async () => {
    const inv = await decompose("# A\n\nfirst\n\n## B\n\nsecond\n\ntail\n", "markdown");
    const paragraphs = inv.definitions.filter((d) => d.capture === "paragraph");
    expect(paragraphs.map((p) => [p.content.trim(), p.parent])).toEqual([
      ["first", "d0"],
      ["second", "d2"],
      ["tail", "d2"],
    ]);
    // flat by construction: no paragraph is ever a parent of anything
    const paragraphLabels = new Set(paragraphs.map((p) => p.label));
    for (const d of inv.definitions) {
      if (d.parent !== undefined) expect(paragraphLabels.has(d.parent)).toBe(false);
    }
  });

  test("paragraphs are not code captures: prose under every heading survives as its own element", async () => {
    // the F-experiment regression guard at the paragraph level: prose that once died inside a
    // composite (the comment-lane trial) now surfaces as a flat paragraph element
    const inv = await decompose("# T\n\nprose line\n\nmore prose\n", "markdown");
    expect(inv.definitions.filter((d) => d.capture === "paragraph")).toHaveLength(2);
  });

  test("the boundary-coincident FINAL sibling survives BECAUSE of #set! selfNesting (the F pin)", async () => {
    // THE F EXPERIMENT'S truth: the last sibling section shares its parent's end offset, so the
    // general tail-distance rule mistakes it for a wrapper payload and absorbs it (13 sections
    // with the directive, 12 without). The directive is the only thing keeping it - pin that.
    const md = await Bun.file(
      new URL("../../../../../tests/fixtures/parity/README.md", import.meta.url),
    ).text();
    const inv = await decompose(md, "markdown");
    const sections = inv.definitions.filter((d) => d.capture === "section");
    expect(sections).toHaveLength(13); // root + 12 children - the absorbed-without-directive case
    const last = sections.at(-1)!;
    expect(last.name).toContain("Dogfood parity");
    expect(last.parent).toBeDefined(); // a child, not a root: it spans to the parent's end
  });
  test("prose, fences, quotes, lists, and link references passthrough (WAITING ledger)", async () => {
    const inv = await decompose(
      "# A\n\nprose\n\n```ts\nconst x = 1;\n```\n\n> quote\n\n- item\n\n[ref]: https://e.com\n",
      "markdown",
    );
    expect(inv.definitions.filter((d) => d.capture === "section").map((d) => d.name)).toEqual([
      "A",
    ]);
    expect(inv.comments).toEqual([]);
    expect(inv.imports).toEqual([]);
  });
});
