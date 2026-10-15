/**
 * The markdown port: sections are the only honest capture; they genuinely nest (selfNesting); every
 * retired stretch is a WAITING in embedded/markdown/queries.scm.
 */
import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

describe("decompose — markdown", () => {
  test("sections capture with their heading text and nest inside each other", async () => {
    const inv = await decompose("# A\n\ntext\n\n## B\n\nmore\n\n# C\n\ntail\n", "markdown");
    expect(inv.definitions.map((d) => [d.name, d.parent])).toEqual([
      ["A", undefined],
      ["B", "d0"],
      ["C", undefined],
    ]);
  });

  test("prose, fences, quotes, lists, and link references passthrough (WAITING ledger)", async () => {
    const inv = await decompose(
      "# A\n\nprose\n\n```ts\nconst x = 1;\n```\n\n> quote\n\n- item\n\n[ref]: https://e.com\n",
      "markdown",
    );
    expect(inv.definitions.map((d) => d.name)).toEqual(["A"]);
    expect(inv.comments).toEqual([]);
    expect(inv.imports).toEqual([]);
  });
});
