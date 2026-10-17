/**
 * Php closures as @function: assigned closures keep ONE element with the function capture (the
 * wrapper assignment wins on the outer node - the ts callable-initializer precedent); bare closures
 * capture as functions; a closure inside a method is suppressed by the opacity policy.
 */
import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

const OPEN = "<?php\n";

describe("php closures", () => {
  test("an assigned arrow is ONE function element, named by its variable", async () => {
    const inv = await decompose(`${OPEN}$pricer = fn(array $xs): int => count($xs);\n`, "php");
    expect(inv.definitions).toHaveLength(1);
    expect(inv.definitions[0]!.capture).toBe("function");
    expect(inv.definitions[0]!.name).toBe("pricer");
    expect(inv.definitions[0]!.content.startsWith("$pricer")).toBe(true);
  });

  test("an assigned anonymous function is ONE function element (no binding twin)", async () => {
    const inv = await decompose(`${OPEN}$maker = function () {\n  return 1;\n};\n`, "php");
    expect(inv.definitions).toHaveLength(1);
    expect(inv.definitions[0]!.capture).toBe("function");
    expect(inv.definitions[0]!.name).toBe("maker");
  });

  test("a bare closure passed as an argument captures as a function", async () => {
    const inv = await decompose(
      `${OPEN}function run(callable $cb) { return $cb(1); }\nrun(fn($v) => $v + 1);\n`,
      "php",
    );
    const fns = inv.definitions.filter((d) => d.capture === "function");
    // run + the argument closure (unassigned, nameless - still a function)
    expect(fns).toHaveLength(2);
  });

  test("a closure inside a method is suppressed - the method interior is opaque", async () => {
    const inv = await decompose(
      `${OPEN}class C {\n  public function m(): array {\n    return array_map(fn($v) => $v + 1, [1, 2]);\n  }\n}\n`,
      "php",
    );
    const kinds = inv.definitions.map((d) => d.capture).sort();
    expect(kinds).toEqual(["class", "method"]);
  });
});
