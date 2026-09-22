import { describe, expect, test } from "bun:test";
import { Language, Parser } from "web-tree-sitter";
import { decompose, type Inventory } from "./decompose.ts";

const GOLDEN = "src/core/types.ts";

async function countCommentNodes(source: string): Promise<number> {
  // Independent count: parse again and walk the whole tree, counting comment nodes.
  await Parser.init({ locateFile: (f: string) => "node_modules/web-tree-sitter/" + f });
  const lang = await Language.load(
    "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm",
  );
  const tree = new Parser().setLanguage(lang).parse(source);
  if (!tree) return 0;
  let count = 0;
  const walk = (node: { type: string; namedChildren: any[] }): void => {
    if (node.type === "comment") count++;
    for (const child of node.namedChildren) walk(child);
  };
  walk(tree.rootNode);
  return count;
}

function attachedCount(inv: Inventory): number {
  return inv.definitions.reduce((sum, d) => sum + (d.attachedComment?.length ?? 0), 0);
}

function internalCount(inv: Inventory): number {
  return inv.definitions.reduce((sum, d) => sum + d.internalCommentCount, 0);
}

function accountedComments(inv: Inventory): number {
  return attachedCount(inv) + inv.comments.length + internalCount(inv);
}

/** Every leaf's byte span must round-trip: src.slice(startByte, endByte) === content. */
function expectSpansRoundTrip(source: string, inv: Inventory): void {
  const leaves = [...inv.definitions, ...inv.comments, ...inv.imports];
  for (const leaf of leaves) {
    expect(leaf.label).toMatch(/^[dci][0-9]+$/);
    expect(source.slice(leaf.span.startByte, leaf.span.endByte)).toBe(leaf.content);
  }
}

describe("decompose — golden fixture (src/core/types.ts)", () => {
  test("produces the expected inventory", async () => {
    const source = await Bun.file(GOLDEN).text();
    const inv = await decompose(source, "typescript");
    expect(inv.hasError).toBe(false);
    // 25 top-level definitions, no imports in this file.
    expect(inv.definitions).toHaveLength(25);
    expect(inv.imports).toHaveLength(0);
    // 28 comment nodes total, all accounted for: attached leading docs, 1 standalone
    // (the file header, separated from the first declaration by a blank line), and nested
    // member-doc comments inside declaration bodies, consumed into their definition leaves.
    expect(accountedComments(inv)).toBe(28);
    expect(attachedCount(inv)).toBe(19);
    expect(inv.comments).toHaveLength(1);
    expect(internalCount(inv)).toBe(8);
    // Labels are stable and positional.
    expect(inv.definitions.map((d) => d.label)).toEqual(
      inv.definitions.map((_, i) => "d" + String(i)),
    );
    expect(inv.comments.map((c) => c.label)).toEqual(["c0"]);
    // The leading declarations, in order; the export wrapper's full text is the content.
    expect(inv.definitions[0]?.nodeType).toBe("type_alias_declaration");
    expect(inv.definitions[0]?.content).toBe('export type Severity = "error" | "warn";');
    const setupErrorDoc = [
      "/**",
      " * A thrown setup/infrastructure failure: invalid config, missing/unreadable entrypoints, invariant",
      " * violations. A real thrown Error — it escapes the pipeline boundary, and the CLI maps its code to",
      " * exit codes exactly once (cli.ts).",
      " */",
    ].join("\n");
    expect(inv.definitions[6]?.attachedComment).toEqual([setupErrorDoc]);
  });

  test("comment-accounting invariant: AST comment count === comments accounted in leaves", async () => {
    const source = await Bun.file(GOLDEN).text();
    const inv = await decompose(source, "typescript");
    expect(accountedComments(inv)).toBe(await countCommentNodes(source));
  });

  test("spans round-trip to the source", async () => {
    const source = await Bun.file(GOLDEN).text();
    const inv = await decompose(source, "typescript");
    expectSpansRoundTrip(source, inv);
    // Line numbers are one-based and point at the leaf's first line.
    expect(inv.comments[0]?.span.start.line).toBe(1);
    expect(inv.definitions[0]?.span.start.line).toBe(15);
  });
});

describe("decompose — imports fixture", () => {
  test("groups all imports into one merged leaf", async () => {
    const source = await Bun.file("src/core/input/fixtures/unit-tree/imports.ts").text();
    const inv = await decompose(source, "typescript");
    expect(inv.imports).toHaveLength(1);
    const merged = inv.imports[0];
    if (!merged) throw new Error("imports fixture must yield one merged leaf");
    expect(merged.label).toBe("i0");
    expect(merged.nodeType).toBe("import_statement");
    // One leaf per file: every import's text is inside the single merged leaf.
    for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
      expect(merged.content).toContain(line);
    }
    // The span covers the first through last import.
    expect(
      source.slice(merged.span.startByte, merged.span.endByte).startsWith("import { readFileSync"),
    ).toBe(true);
    // The doc comment before the const attaches; the export wrapper is unwrapped.
    const thing = inv.definitions.find((d) => d.content.includes("export const thing"));
    expect(thing?.attachedComment).toEqual(["/** Doc for thing. */"]);
    expectSpansRoundTrip(source, inv);
  });
});

describe("decompose — standalone-comment fixture", () => {
  test("separated and trailing comments land standalone, never attached", async () => {
    const source = await Bun.file("src/core/input/fixtures/unit-tree/standalone-comment.ts").text();
    const inv = await decompose(source, "typescript");
    expect(inv.comments).toHaveLength(2);
    expect(inv.comments[0]?.content).toContain("file-header comment");
    expect(inv.comments[1]?.content).toContain("trailing comment at EOF");
    expect(inv.definitions.every((d) => !d.attachedComment)).toBe(true);
  });
});

describe("decompose — comment-orphan fixture", () => {
  test("orphans land standalone; comments before imports never attach", async () => {
    const source = await Bun.file("src/core/input/fixtures/unit-tree/comment-orphan.ts").text();
    const inv = await decompose(source, "typescript");
    expect(attachedCount(inv)).toBe(0);
    expect(inv.comments).toHaveLength(2);
    expect(accountedComments(inv)).toBe(await countCommentNodes(source));
  });
});

describe("decompose — graceful degradation", () => {
  test("a parse with errors still yields the blocks that parsed, flagged via hasError", async () => {
    const source = [
      "export const fine = 1;",
      "export const broken = ;;;;", // syntax error from here on
      "function oops( {", // unterminated
    ].join("\n");
    const inv = await decompose(source, "typescript");
    expect(inv.hasError).toBe(true);
    // The well-formed top-level block before the errors is still extracted, exactly.
    expect(inv.definitions.map((d) => d.content)).toContain("export const fine = 1;");
    expectSpansRoundTrip(source, inv);
  });
});

describe("decompose — languages", () => {
  test("unknown language throws INTERNAL, with a clear message", async () => {
    expect(decompose("x", "cobol")).rejects.toMatchObject({ code: "INTERNAL" });
  });

  test("the parser instance is cached per language", async () => {
    // Same call twice in one process: both succeed against the shared cached parser.
    const a = await decompose("const a = 1;", "typescript");
    const b = await decompose("const b = 2;", "typescript");
    expect(a.hasError).toBe(false);
    expect(b.definitions[0]?.label).toBe("d0");
  });
});
