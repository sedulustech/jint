/** The python port: decorated absorb, docstring ownership (string-in-block). */
import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

describe("decompose — python", () => {
  test("functions and classes capture with their noun; assignments passthrough", async () => {
    const inv = await decompose(
      "def handler():\n    return 1\n\nclass Thing:\n    pass\n\nx = 1\n",
      "python",
    );
    expect(inv.definitions.map((d) => [d.capture, d.name])).toEqual([
      ["function", "handler"],
      ["class", "Thing"],
    ]);
  });

  test("absorb: a decorated definition is the element - the decorator travels", async () => {
    const inv = await decompose("@decorator\ndef handler():\n    return 1\n", "python");
    expect(inv.definitions).toHaveLength(1);
    expect(inv.definitions[0]!.nodeType).toBe("decorated_definition");
    expect(inv.definitions[0]!.content.startsWith("@decorator")).toBe(true);
    expect(inv.definitions[0]!.name).toBe("handler");
  });

  test("docstrings are owned comment elements, never internal counts", async () => {
    const inv = await decompose(
      '"""Module docs."""\n\ndef handler():\n    """Handles it."""\n    # internal\n    return 1\n\nclass Thing:\n    """Class docs."""\n    pass\n',
      "python",
    );
    const byContent = new Map(inv.comments.map((c) => [c.content, c]));
    expect(byContent.get('"""Module docs."""')!.docstringOf).toEqual({ kind: "module", name: "" });
    expect(byContent.get('"""Handles it."""')!.docstringOf).toEqual({
      kind: "function",
      name: "handler",
    });
    expect(byContent.get('"""Class docs."""')!.docstringOf).toEqual({
      kind: "class",
      name: "Thing",
    });
    const handler = inv.definitions[0]!;
    expect(handler.internalCommentCount).toBe(1);
  });

  test("imports merge into one element", async () => {
    const inv = await decompose("import os\nfrom sys import path\n", "python");
    expect(inv.imports).toHaveLength(1);
    expect(inv.imports[0]!.content.split("\n")).toHaveLength(2);
  });
});
