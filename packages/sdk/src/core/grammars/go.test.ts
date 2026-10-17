/** The go port: flat declarations, single-spec name anchoring, package-level bindings. */
import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

describe("decompose — go", () => {
  test("functions, methods, and type declarations capture; methods sit outside their type", async () => {
    const inv = await decompose(
      'func Top() {}\n\nfunc (s Store) Get() string { return "" }\n\ntype Config struct{}\n',
      "go",
    );
    expect(inv.definitions.map((d) => [d.capture, d.name])).toEqual([
      ["function", "Top"],
      ["method", "Get"],
      ["type", "Config"],
    ]);
    expect(inv.definitions[1]!.parent).toBeUndefined();
  });

  test("a single-spec const/var takes its name; multi-spec blocks stay nameless", async () => {
    const inv = await decompose(
      "const Single = 1\n\nconst (\n\tA = 1\n\tB = 2\n)\n\nvar Both = 2\n",
      "go",
    );
    expect(inv.definitions.map((d) => [d.capture, d.name])).toEqual([
      ["binding", "Single"],
      ["binding", undefined],
      ["binding", "Both"],
    ]);
  });

  test("doc comments attach as the leading run; a consts-only file still yields elements", async () => {
    const inv = await decompose("// Rate limits the thing.\nconst Rate = 3\n", "go");
    expect(inv.definitions[0]!.attachedComment).toEqual(["// Rate limits the thing."]);
  });
});
