/**
 * The cpp port: c's split plus classes, method prototypes on field_declaration nodes (the priority
 * split the steer asked for - member FUNCTIONS surface, member DATA stays WAITING), and template
 * absorb through the policy table's type absorbTail (trailing ';' included).
 */
import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

describe("decompose — cpp", () => {
  test("classes, methods, prototypes, and free functions capture with names", async () => {
    const inv = await decompose(
      [
        "class Handler {",
        " public:",
        "  int budget = 3;",
        "  bool handle(int code);",
        "  void reset() { budget = 0; }",
        "};",
        "int encode(int value) { return value; }",
      ].join("\n"),
      "cpp",
    );
    expect(inv.definitions.map((d) => [d.capture, d.name, d.parent])).toEqual([
      ["type", "Handler", undefined],
      // member function prototype: field_declaration, split from member data by priority
      ["function", "handle", "d0"],
      // member definition: function_definition inside the class
      ["function", "reset", "d0"],
      ["function", "encode", undefined],
    ]);
    // member data (budget) stays inside the class: the field capture is WAITING
    expect(inv.definitions).toHaveLength(4);
  });

  test("a template declaration absorbs its payload, trailing ';' included", async () => {
    const inv = await decompose(
      "template<typename T>\nclass Box {\n  T value;\n};\n\ntemplate<typename T>\nT pick(Box<T> box) {\n  return box.value;\n}\n",
      "cpp",
    );
    expect(inv.definitions.map((d) => [d.capture, d.name, d.nodeType])).toEqual([
      ["type", undefined, "template_declaration"],
      ["function", "pick", "template_declaration"],
    ]);
    expect(inv.definitions[0]!.content.endsWith("};")).toBe(true);
  });
});
