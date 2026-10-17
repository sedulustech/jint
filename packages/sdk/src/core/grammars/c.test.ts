/**
 * The c port: pattern priority splits prototypes from state (the trial's wanted discriminator);
 * names descend through pointer declarators; a function definition is never nameless in practice,
 * but the nameless fallback guarantees it is never lost.
 */
import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

describe("decompose — c", () => {
  test("definitions, prototypes (as functions), types, and state capture with names", async () => {
    const inv = await decompose(
      [
        "enum Status { OK = 0 };",
        "struct Ring { int head; };",
        "typedef struct Ring *RingHandle;",
        "static int g_capacity = 16;",
        "int ring_init(struct Ring *r, int cap);",
        "struct Ring *ring_create(int cap) { return 0; }",
      ].join("\n"),
      "c",
    );
    expect(inv.definitions.map((d) => [d.capture, d.name, d.nodeType])).toEqual([
      ["type", "Status", "enum_specifier"],
      ["type", "Ring", "struct_specifier"],
      ["type", "RingHandle", "type_definition"],
      ["binding", "g_capacity", "declaration"],
      // the prototype: a function unit, split from state by function_declarator priority
      ["function", "ring_init", "declaration"],
      // pointer return type: the name is two declarators deep
      ["function", "ring_create", "function_definition"],
    ]);
  });

  test("local declarations stay inside their function (opaque interior)", async () => {
    const inv = await decompose("void f(void) { int local = 1; }\n", "c");
    expect(inv.definitions).toHaveLength(1);
  });

  test("a leading comment attaches; includes merge into one import element", async () => {
    const inv = await decompose(
      '#include <stdlib.h>\n#include "ring.h"\n/* Creates a ring. */\nvoid f(void) {}\n',
      "c",
    );
    expect(inv.definitions[0]!.attachedComment).toEqual(["/* Creates a ring. */"]);
    expect(inv.imports).toHaveLength(1);
  });
});
