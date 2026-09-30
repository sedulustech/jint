import { describe, expect, test } from "bun:test";
import { Language, Parser } from "web-tree-sitter";
import { decompose, isEmptyComment, MAX_ELEMENT_CHARS, type Inventory } from "./walk.ts";

const GOLDEN = "packages/sdk/src/core/types.ts";

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

/** Every element's byte span must round-trip: src.slice(startByte, endByte) === content. */
function expectSpansRoundTrip(source: string, inv: Inventory): void {
  const elements = [...inv.definitions, ...inv.comments, ...inv.imports];
  for (const element of elements) {
    expect(element.label).toMatch(/^[dci][0-9]+$/);
    expect(source.slice(element.span.startByte, element.span.endByte)).toBe(element.content);
  }
}

describe("decompose — golden fixture (packages/sdk/src/core/types.ts)", () => {
  test("produces the expected inventory", async () => {
    const source = await Bun.file(GOLDEN).text();
    const inv = await decompose(source, "typescript");
    expect(inv.hasError).toBe(false);
    // Top-level definitions + method elements from composite descent into the class declaration,
    // no imports in this file (golden tracks packages/sdk/src/core/types.ts — update when it grows).
    expect(inv.definitions).toHaveLength(43);
    expect(inv.imports).toHaveLength(0);
    // Comment nodes all accounted for: leading docs attached, 1 standalone (the file header,
    // separated from the first declaration by a blank line), and member-doc comments inside
    // declaration bodies, consumed into their definition elements.
    expect(accountedComments(inv)).toBe(45);
    expect(attachedCount(inv)).toBe(28);
    expect(inv.comments).toHaveLength(1);
    expect(internalCount(inv)).toBe(16);
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
    expect(inv.definitions[7]?.attachedComment).toEqual([setupErrorDoc]);
  });

  test("comment-accounting invariant: AST comment count === comments accounted in elements", async () => {
    const source = await Bun.file(GOLDEN).text();
    const inv = await decompose(source, "typescript");
    expect(accountedComments(inv)).toBe(await countCommentNodes(source));
  });

  test("spans round-trip to the source", async () => {
    const source = await Bun.file(GOLDEN).text();
    const inv = await decompose(source, "typescript");
    expectSpansRoundTrip(source, inv);
    // Line numbers are one-based and point at the element's first line.
    expect(inv.comments[0]?.span.start.line).toBe(1);
    expect(inv.definitions[0]?.span.start.line).toBe(14);
  });
});

describe("decompose — imports fixture", () => {
  test("groups all imports into one merged element", async () => {
    const source = await Bun.file(
      "packages/sdk/src/core/input/fixtures/unit-tree/imports.ts",
    ).text();
    const inv = await decompose(source, "typescript");
    expect(inv.imports).toHaveLength(1);
    const merged = inv.imports[0];
    if (!merged) throw new Error("imports fixture must yield one merged element");
    expect(merged.label).toBe("i0");
    expect(merged.nodeType).toBe("import_statement");
    // One element per file: every import's text is inside the single merged element.
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
    const source = await Bun.file(
      "packages/sdk/src/core/input/fixtures/unit-tree/standalone-comment.ts",
    ).text();
    const inv = await decompose(source, "typescript");
    expect(inv.comments).toHaveLength(2);
    expect(inv.comments[0]?.content).toContain("file-header comment");
    expect(inv.comments[1]?.content).toContain("trailing comment at EOF");
    expect(inv.definitions.every((d) => !d.attachedComment)).toBe(true);
  });
});

describe("decompose — comment-orphan fixture", () => {
  test("orphans land standalone; comments before imports never attach", async () => {
    const source = await Bun.file(
      "packages/sdk/src/core/input/fixtures/unit-tree/comment-orphan.ts",
    ).text();
    const inv = await decompose(source, "typescript");
    expect(attachedCount(inv)).toBe(0);
    expect(inv.comments).toHaveLength(2);
    expect(accountedComments(inv)).toBe(await countCommentNodes(source));
  });
});

describe("decompose — graceful degradation", () => {
  test("a parse with errors still yields the elements that parsed, flagged via hasError", async () => {
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

describe("decompose — composite-descent fixture", () => {
  test("parent labels thread the hierarchy: docstring/method -> owner, top-level -> none", async () => {
    const inv = await decompose(
      [
        '"""Module docstring."""',
        "",
        "",
        "def outer():",
        '    """Docs for outer."""',
        "    return 1",
        "",
      ].join("\n"),
      "python",
    );
    const outer = inv.definitions.find((d) => d.role === "function")!;
    // A top-level function has no parent label; its docstring (a comment element) points back.
    expect(outer.parent).toBeUndefined();
    const doc = inv.comments.find((c) => c.docstringOf?.kind === "function");
    expect(doc).toBeDefined();
    expect(doc!.parent).toBe(outer.label);
  });

  test("typescript class methods carry their class header's label as parent", async () => {
    const inv = await decompose(
      ["class Widget {", "  render(): string {", "    return 'x';", "  }", "}"].join("\n"),
      "typescript",
    );
    const klass = inv.definitions.find((d) => d.nodeType === "class_declaration")!;
    const method = inv.definitions.find((d) => d.nodeType === "method_definition")!;
    expect(method.parent).toBe(klass.label);
    // Top-level class: no parent.
    expect(klass.parent).toBeUndefined();
  });

  test("composites are judged AND descended into: nested calls, class methods, sub-spans", async () => {
    const source = await Bun.file(
      "packages/sdk/src/core/input/fixtures/unit-tree/composite-tree.ts",
    ).text();
    const inv = await decompose(source, "typescript");
    // Headers flow into existing roles: call expressions -> function, class -> type.
    expect(
      inv.definitions.some((d) => d.role === "function" && d.content.startsWith("describe(")),
    ).toBe(true);
    expect(inv.definitions.some((d) => d.role === "function" && d.content.startsWith("it("))).toBe(
      true,
    );
    // Class header is an element (type role) and its methods are elements of their own.
    expect(
      inv.definitions.some((d) => d.role === "type" && d.nodeType === "class_declaration"),
    ).toBe(true);
    // The class element is a HEADER state now: declaration through the opening brace, no body.
    const klass = inv.definitions.find((d) => d.nodeType === "class_declaration")!;
    expect(klass.content).toBe("class Widget");
    expect(klass.content).not.toContain("render");
    // Its method is still a child element of its own, with the full body.
    const method = inv.definitions.find((d) => d.nodeType === "method_definition")!;
    expect(method.content).toContain("render(): string");
    expect(method.content).toContain("return");
    // Descent is recursive: expect(...) inside it(...) is its own element.
    expect(inv.definitions.some((d) => d.content.startsWith("expect("))).toBe(true);
    // Inner elements stay after their composite; the composite's span is its header now, so
    // inner spans are no longer contained by it — identity is span-derived, not containment.
    const outerSpan = inv.definitions.find((d) => d.content.startsWith('describe("outer"'))!.span;
    const innerSpan = inv.definitions.find((d) => d.content.startsWith("it("))!.span;
    expect(innerSpan.start.line).toBeGreaterThan(outerSpan.start.line);
    expect(outerSpan.end.line).toBe(outerSpan.start.line); // header-only: single line
    expectSpansRoundTrip(source, inv);
    expect(accountedComments(inv)).toBe(await countCommentNodes(source));
  });
});

describe("decompose — oversized backstop", () => {
  test("an element over MAX_ELEMENT_CHARS is flagged oversized and counted, language-agnostic", async () => {
    // A giant single expression element: over the backstop, flagged, still emitted.
    const source =
      "const big = [" +
      Array.from({ length: 500 }, () => '"' + "x".repeat(40) + '"').join(", ") +
      "];";
    expect(source.length).toBeGreaterThan(MAX_ELEMENT_CHARS);
    const inv = await decompose(source, "typescript");
    expect(inv.definitions).toHaveLength(1);
    expect(inv.definitions[0]!.oversized).toBe(true);
    expect(inv.oversizedCount).toBe(1);
    expectSpansRoundTrip(source, inv);
  });

  test("a python class header ends at its colon; no brace, header still bounded", async () => {
    const source = "class Greeter:\n    def hi(self):\n        pass";
    const inv = await decompose(source, "python");
    expect(inv.definitions[0]!.content).toBe("class Greeter:");
  });
});

describe("decompose — python", () => {
  const PY_SOURCE = [
    '"""Module docstring."""',
    "import os",
    "",
    "# leading comment",
    "def greet(name):",
    '    """Doc."""',
    '    return "hi " + name',
    "",
    "@decorator",
    "class Greeter:",
    "    def method(self):",
    "        pass",
    "",
    "class Inner:",
    "    pass",
    "",
  ].join("\n");

  test("functions, classes, decorated defs, comments, imports extract with existing roles", async () => {
    const inv = await decompose(PY_SOURCE, "python");
    expect(inv.hasError).toBe(false);
    const shapes = inv.definitions.map((d) => [d.nodeType, d.role]);
    expect(shapes).toEqual([
      ["function_definition", "function"],
      ["class_definition", "type"],
      // Greeter's method: composite descent yields it as an element of its own.
      ["function_definition", "function"],
      ["class_definition", "type"],
    ]);
    // Decorator stays in the element content; decorated def unwraps to its class.
    expect(inv.definitions[1]!.content.startsWith("@decorator")).toBe(true);
    // Composite descent: the method inside Greeter is an element of its own.
    expect(
      inv.definitions.some(
        (d) => d.nodeType === "function_definition" && d.content.includes("def method"),
      ),
    ).toBe(true);
    // Leading comment attaches to the function that follows it.
    expect(inv.definitions[0]!.attachedComment).toEqual(["# leading comment"]);
    // Docstrings are comment elements owned by their construct: the module docstring plus
    // greet's — neither is an orphan.
    expect(inv.comments.map((c) => [c.content, c.docstringOf])).toEqual([
      ['"""Module docstring."""', { kind: "module", name: "" }],
      ['"""Doc."""', { kind: "function", name: "greet" }],
    ]);
    expect(inv.imports).toHaveLength(1);
    expect(inv.imports[0]!.content).toBe("import os");
    expectSpansRoundTrip(PY_SOURCE, inv);
  });

  test("docstrings get owners on def, class, and module; non-first strings stay plain", async () => {
    const source = [
      '"""Module docs."""',
      "def f():",
      '    """Function docs."""',
      "    return 1",
      "",
      "class C:",
      '    """Class docs."""',
      "    x = 1",
      "",
      "# plain narration comment — standalone, no definition follows",
      'x = "not first, not a docstring"',
      "",
      "def g():",
      "    pass",
      "",
    ].join("\n");
    const inv = await decompose(source, "python");
    expect(inv.hasError).toBe(false);
    const docstrings = inv.comments
      .filter((c) => c.docstringOf)
      .map((c) => [c.content, c.docstringOf?.kind, c.docstringOf?.name]);
    expect(docstrings).toEqual([
      ['"""Module docs."""', "module", ""],
      ['"""Function docs."""', "function", "f"],
      ['"""Class docs."""', "class", "C"],
    ]);
    // A string expression NOT in first position is not a docstring (here: a plain assignment).
    expect(inv.comments.some((c) => c.content.includes("not first"))).toBe(false);
    expect(
      inv.definitions.some((d) => d.nodeType === "assignment" && d.content.includes("not first")),
    ).toBe(false);
    // Plain # comments are unaffected: no owner, still standalone.
    expect(
      inv.comments.some((c) => c.content.startsWith("# plain narration comment") && !c.docstringOf),
    ).toBe(true);
    expectSpansRoundTrip(source, inv);
  });

  test("typescript is unaffected by the python mapping", async () => {
    const inv = await decompose("function f() {}\n// note\n", "typescript");
    expect(inv.hasError).toBe(false);
    expect(inv.definitions[0]!.role).toBe("function");
    expect(inv.comments.map((c) => c.content)).toEqual(["// note"]);
  });

  test("unsupported language throws SetupError", async () => {
    expect(decompose("x", "cobol")).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("decompose — go", () => {
  const GO_SOURCE = [
    "package main",
    "",
    'import "fmt"',
    "",
    "// greet says hi.",
    "func greet(name string) string {",
    "\t// internal note",
    '\treturn "hi " + name',
    "}",
    "",
    "func (g *Greeter) greetLoudly() string {",
    "\treturn strings.ToUpper(greet(g.name))",
    "}",
    "",
    "type Greeter struct {",
    "\tname string // field doc",
    "}",
    "",
    "type Greeter interface {",
    "\tgreetLoudly() string",
    "}",
    "",
    "func standalone() {}",
    "",
  ].join("\n");

  test("funcs, methods, structs, interfaces, comments, imports extract with existing roles", async () => {
    const inv = await decompose(GO_SOURCE, "go");
    expect(inv.hasError).toBe(false);
    const shapes = inv.definitions.map((d) => [d.nodeType, d.role]);
    expect(shapes).toEqual([
      ["function_declaration", "function"],
      // Method with receiver: Go keeps methods top-level, not nested in the type.
      ["method_declaration", "function"],
      ["type_declaration", "type"],
      ["type_declaration", "type"],
      ["function_declaration", "function"],
    ]);
    // Doc comment attaches to the func that follows it; internal comment stays inside.
    expect(inv.definitions[0]!.attachedComment).toEqual(["// greet says hi."]);
    expect(inv.definitions[0]!.internalCommentCount).toBe(1);
    expect(inv.comments).toHaveLength(0);
    expect(inv.imports).toHaveLength(1);
    expect(inv.imports[0]!.content).toBe('import "fmt"');
    expectSpansRoundTrip(GO_SOURCE, inv);
  });

  test("no composite descent: struct/interface members and method bodies stay flat", async () => {
    const inv = await decompose(GO_SOURCE, "go");
    // Exactly the five top-level declarations — no elements synthesized from struct fields,
    // interface methods, or statements inside function bodies.
    expect(inv.definitions).toHaveLength(5);
    expect(
      inv.definitions.some(
        (d) =>
          d.nodeType !== "function_declaration" &&
          d.nodeType !== "method_declaration" &&
          d.nodeType !== "type_declaration",
      ),
    ).toBe(false);
  });

  test("consts-only and vars-only files produce data elements, not empty inventories", async () => {
    const source = [
      "package p",
      "",
      "const (",
      '\tRedisNull = "<nil>"',
      ")",
      "",
      'var ErrClosed = errors.New("closed")',
      "",
    ].join("\n");
    const inv = await decompose(source, "go");
    expect(inv.hasError).toBe(false);
    expect(inv.definitions.map((d) => [d.nodeType, d.role])).toEqual([
      ["const_declaration", "binding"],
      ["var_declaration", "binding"],
    ]);
    expectSpansRoundTrip(source, inv);
  });

  test("the predicate: empty iff no letter or digit", () => {
    const empty = [
      "//",
      "// ",
      "//\t",
      "/* */",
      "/*----*/",
      "///",
      "/// ",
      "#",
      "# ---",
      "--",
      "// ----",
      "// !!!",
      "",
      "// \u00a0",
    ];
    for (const text of empty) expect(isEmptyComment(text), JSON.stringify(text)).toBe(true);
    const content = [
      "//x",
      "// x",
      "// 1. first",
      "// TODO: fix",
      "// émoji 🎉",
      "// 中文注释",
      "// 0x1F",
      "//\u00a0non-breaking",
      "/* body */",
    ];
    for (const text of content) expect(isEmptyComment(text), JSON.stringify(text)).toBe(false);
  });

  test("bare markers yield no comment elements; real comments still do", async () => {
    const source = ["package p", "", "//", "/* */", "// ----", "///", "", "func f() {}"].join("\n");
    const inv = await decompose(source, "go");
    expect(inv.hasError).toBe(false);
    expect(inv.comments).toHaveLength(0);
    // attached/internal counting is unaffected — the definition still exists.
    expect(inv.definitions).toHaveLength(1);
  });

  test("comments with letters or digits remain comment elements", async () => {
    const source = [
      "package p",
      "",
      "// 1. retry",
      "// TODO",
      "// ---- divider with words",
      "",
      "func f() {}",
    ].join("\n");
    const inv = await decompose(source, "go");
    expect(inv.comments.map((c) => c.content)).toEqual([
      "// 1. retry",
      "// TODO",
      "// ---- divider with words",
    ]);
    expectSpansRoundTrip(source, inv);
  });

  test("decoration-only lines are dropped in every shipped grammar", async () => {
    const ts = await decompose(
      ["// ----", "// ====", "/* */", "function f() {}"].join("\n"),
      "typescript",
    );
    expect(ts.comments).toHaveLength(0);
    const py = await decompose(["# ---", "def f():", "    pass"].join("\n"), "python");
    expect(py.comments).toHaveLength(0);
  });

  test("bare markers in each shipped grammar yield zero comment elements", async () => {
    // Go: line + block + doc + decoration.
    const go = await decompose(
      ["package p", "", "//", "/* */", "///", "// ----", "", "func f() {}"].join("\n"),
      "go",
    );
    expect(go.comments).toHaveLength(0);
    expect(go.definitions).toHaveLength(1);
    // TypeScript: bare line comment.
    const ts = await decompose(["//", "function f() {}"].join("\n"), "typescript");
    expect(ts.comments).toHaveLength(0);
    // Python: bare `#` — the grammar DOES emit a comment node for it (verified), and the
    // filter drops it.
    const py = await decompose(["#", "def f():", "    pass"].join("\n"), "python");
    expect(py.comments).toHaveLength(0);
    // Rust is not shipped (LANGUAGES: typescript, python, go) — no /// or //! case exists.
  });

  test("tricky real comments are never dropped", async () => {
    const source = [
      "package p",
      "",
      "// 1. first",
      "// TODO: fix",
      "// émoji 🎉",
      "// 中文注释",
      "// 0x1F",
      "// x",
      "func f() {}",
      "",
    ].join("\n");
    const inv = await decompose(source, "go");
    // Six real comments attach to the func; nothing was lost to the filter.
    expect(inv.definitions[0]!.attachedComment).toHaveLength(6);
    expect(inv.comments).toHaveLength(0);
    // Python `#` form with real content survives too. (Note: `# from __future__ ...` parses
    // as a future_import_statement, not a comment — grammar-level, filter-independent.)
    const py = await decompose(
      ["# retry with backoff", "def f():", "    pass", "# tail"].join("\n"),
      "python",
    );
    expect(py.comments.map((c) => c.content)).toEqual(["# tail"]);
    expect(py.definitions[0]!.attachedComment).toEqual(["# retry with backoff"]);
    expectSpansRoundTrip(source, inv);
  });

  test("attachment: a real comment still attaches; an empty one disconnects cleanly", async () => {
    const real = await decompose(
      ["package p", "", "// documented", "func f() {}"].join("\n"),
      "go",
    );
    expect(real.definitions[0]!.attachedComment).toEqual(["// documented"]);
    const bare = await decompose(["package p", "", "//", "func f() {}"].join("\n"), "go");
    expect(bare.definitions[0]!.attachedComment).toBeUndefined();
  });

  test("an empty marker does not split a run of real comments", async () => {
    const inv = await decompose(
      ["package p", "", "// real", "//", "// real2", "func f() {}", ""].join("\n"),
      "go",
    );
    expect(inv.definitions[0]!.attachedComment).toEqual(["// real", "// real2"]);
    expect(inv.comments).toHaveLength(0);
  });

  test("internalCommentCount drops empty body comments, keeps real ones", async () => {
    const real = await decompose(["package p", "", "func f() {", "// inner", "}"].join("\n"), "go");
    expect(real.definitions[0]!.internalCommentCount).toBe(1);
    const bare = await decompose(
      ["package p", "", "func f() {", "//", "// ----", "}"].join("\n"),
      "go",
    );
    expect(bare.definitions[0]!.internalCommentCount).toBe(0);
  });

  test("typescript and python are unaffected by the go mapping", async () => {
    const ts = await decompose("function f() {}\n// note\n", "typescript");
    expect(ts.definitions[0]!.role).toBe("function");
    expect(ts.comments.map((c) => c.content)).toEqual(["// note"]);
    const py = await decompose('"""Doc."""\ndef f():\n    pass\n', "python");
    expect(py.definitions[0]!.role).toBe("function");
    expect(py.comments[0]!.docstringOf).toEqual({ kind: "module", name: "" });
  });
});

describe("decompose — variable declaration roles", () => {
  test("a binding const is role binding, never function; an arrow const stays function", async () => {
    const source = [
      "const report = buildReport();",
      "const add = (a: number, b: number): number => a + b;",
      "function declared(): void {}",
    ].join("\n");
    const inv = await decompose(source, "typescript");
    const binding = inv.definitions.find((d) => d.content.startsWith("const report"));
    expect(binding?.role).toBe("binding");
    expect(binding?.nodeType).toBe("lexical_declaration");
    const arrow = inv.definitions.find((d) => d.content.startsWith("const add"));
    expect(arrow?.role).toBe("function");
    const fn = inv.definitions.find((d) => d.content.startsWith("function declared"));
    expect(fn?.role).toBe("function");
    expectSpansRoundTrip(source, inv);
  });
});
