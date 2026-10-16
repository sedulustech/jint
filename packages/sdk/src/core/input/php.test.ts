/**
 * The php port: @name on the universal `name` node kills the trial's names blocker; the trial's
 * closure stretch is retired (a closure assignment is an honest named binding); the include stretch
 * stays retired (runtime control flow, transit).
 */
import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

const SRC = [
  "<?php",
  "namespace App\\Inventory;",
  "",
  "use App\\Support\\Money;",
  "",
  "/** Items know how to price themselves. */",
  "class Item {",
  "    private int $stock = 0;",
  "",
  "    public function restock(int $n): void {",
  "        return;",
  "    }",
  "}",
  "",
  "function total(array $items): int { return 0; }",
  "",
  "$pricer = fn(array $xs): int => count($xs);",
  "const TAX_RATE = 21;",
  "",
  "interface Named {",
  "    public function name(): string;",
  "}",
].join("\n");

describe("decompose — php", () => {
  test("classes, methods, functions, and interfaces capture with their names", async () => {
    const inv = await decompose(SRC, "php");
    expect(inv.definitions.map((d) => [d.capture, d.name])).toEqual([
      ["class", "Item"],
      ["method", "restock"],
      ["function", "total"],
      ["binding", "pricer"],
      ["binding", "TAX_RATE"],
      ["type", "Named"],
      ["method", "name"],
    ]);
    // member data (stock) stays inside its class: the field capture is WAITING
    expect(inv.definitions[0]!.internalCommentCount).toBe(0);
  });

  test("doc blocks attach; the use statement merges to one import", async () => {
    const inv = await decompose(SRC, "php");
    expect(inv.definitions[0]!.attachedComment).toEqual([
      "/** Items know how to price themselves. */",
    ]);
    expect(inv.imports).toHaveLength(1);
  });
});
