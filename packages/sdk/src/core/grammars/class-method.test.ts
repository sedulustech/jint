import { describe, expect, test } from "bun:test";
import { decompose, type Inventory } from "./walk.ts";

// The @class / @method split, verified per grammar (comment-targets style): class-like units
// capture as @class, member functions as @method, and everything that is NOT a class stays @type
// (interfaces, structs, enums, aliases, sections). Flat nouns at both layers - no dotted names.

const counts = (inv: Inventory) => {
  const out: Record<string, number> = {};
  for (const e of inv.definitions) out[e.capture] = (out[e.capture] ?? 0) + 1;
  return out;
};

describe("class/method captures across the grammars", () => {
  test("typescript: class split out of type; methods split out of function", async () => {
    const inv = await decompose(
      [
        "interface Shape { area(): number }",
        "type Alias = number;",
        "enum Color { Red }",
        "export class Rect implements Shape {",
        "  area(): number { return 1; }",
        "  scale(f: number): this { return this; }",
        "}",
      ].join("\n"),
      "typescript",
    );
    expect(counts(inv)).toEqual({ type: 3, class: 1, method: 2 });
    expect(inv.definitions.find((e) => e.capture === "class")!.name).toBe("Rect");
  });

  test("tsx: same split as typescript", async () => {
    const inv = await decompose(
      ["class Card {", "  render(): string {", "    return '';", "  }", "}"].join("\n"),
      "tsx",
    );
    expect(counts(inv)).toEqual({ class: 1, method: 1 });
  });

  test("python: methods are function_definitions inside a class body (context capture)", async () => {
    const inv = await decompose(
      [
        "class Widget:",
        "    def size(self):",
        "        return 1",
        "",
        "    @property",
        "    def name(self):",
        "        return 'w'",
        "",
        "def free():",
        "    pass",
      ].join("\n"),
      "python",
    );
    expect(counts(inv)).toEqual({ class: 1, method: 2, function: 1 });
    // the decorated method carries its decorator (the wrapper is the element)
    const prop = inv.definitions.find((e) => e.name === "name")!;
    expect(prop.nodeType).toBe("decorated_definition");
    expect(prop.content.startsWith("@property")).toBe(true);
  });

  test("python: a function nested inside a method does NOT surface as a method", async () => {
    const inv = await decompose(
      [
        "class C:",
        "    def outer(self):",
        "        def nested():",
        "            pass",
        "        return nested",
      ].join("\n"),
      "python",
    );
    expect(counts(inv)).toEqual({ class: 1, method: 1 });
  });

  test("php: named classes only (anonymous_class stays unjudged); interface methods are methods", async () => {
    const inv = await decompose(
      [
        "<?php",
        "interface Named {",
        "    public function name(): string;",
        "}",
        "class Item implements Named {",
        "    public function name(): string { return ''; }",
        "}",
      ].join("\n"),
      "php",
    );
    expect(counts(inv)).toEqual({ type: 1, class: 1, method: 2 });
  });

  test("go: methods split out of functions; the struct stays @type (no @class in go)", async () => {
    const inv = await decompose(
      [
        "package p",
        "",
        "type Store struct{ n int }",
        "",
        "func (s Store) Get() int { return s.n }",
        "",
        "func Free() {}",
      ].join("\n"),
      "go",
    );
    expect(counts(inv)).toEqual({ type: 1, method: 1, function: 1 });
  });

  test("cpp: in-class prototypes and definitions are methods; the out-of-line K::f is a method; structs stay type", async () => {
    const inv = await decompose(
      [
        "struct S { int y; };",
        "class K {",
        "  int f(int x);",
        "  int g(int x) { return x; }",
        "};",
        "int K::f(int x) { return x; }",
      ].join("\n"),
      "cpp",
    );
    expect(counts(inv)).toEqual({ type: 1, class: 1, method: 3 });
    expect(inv.definitions.find((e) => e.name === "K::f")!.capture).toBe("method");
  });

  test("grammars with no class/method shapes extract none of them", async () => {
    for (const language of ["c", "css", "markdown"] as const) {
      const inv = await decompose(SOURCES[language]!, language);
      expect(counts(inv)["class"], language).toBeUndefined();
      expect(counts(inv)["method"], language).toBeUndefined();
    }
  });
});

const SOURCES: Record<string, string> = {
  c: "int add(int a, int b) {\n  return a + b;\n}\n",
  css: "body { color: red; }\n",
  markdown: "# Title\n\nProse.\n",
};
