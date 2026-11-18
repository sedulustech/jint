import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

// One table, every embedded grammar with definitions: a definition's signature is its text up to
// the body its pattern marks @body. Each signature spans several rows, so a first-line guess fails.
const CASES: readonly { language: string; source: string; name: string; signature: string }[] = [
  {
    language: "typescript",
    source: "export function add(\n  a: number,\n  b: number,\n): number {\n  return a + b;\n}\n",
    name: "add",
    signature: "export function add(\n  a: number,\n  b: number,\n): number",
  },
  {
    language: "typescript",
    source: "class Box {\n  grow(\n    n: number,\n  ): void {\n    this.n += n;\n  }\n}\n",
    name: "grow",
    signature: "grow(\n    n: number,\n  ): void",
  },
  {
    language: "typescript",
    source: "const add = (\n  a: number,\n) => {\n  return a;\n};\n",
    name: "add",
    signature: "const add = (\n  a: number,\n) =>",
  },
  {
    language: "tsx",
    source: "export class Box\n  extends Base {\n  n = 0;\n}\n",
    name: "Box",
    signature: "export class Box\n  extends Base",
  },
  {
    language: "c",
    source: "int add(\n  int a,\n  int b\n) {\n  return a + b;\n}\n",
    name: "add",
    signature: "int add(\n  int a,\n  int b\n)",
  },
  {
    language: "cpp",
    source: "int add(\n  int a,\n  int b\n) {\n  return a + b;\n}\n",
    name: "add",
    signature: "int add(\n  int a,\n  int b\n)",
  },
  {
    language: "go",
    source: "package main\n\nfunc add(\n\ta int,\n\tb int,\n) int {\n\treturn a + b\n}\n",
    name: "add",
    signature: "func add(\n\ta int,\n\tb int,\n) int",
  },
  {
    language: "php",
    source: "<?php\nfunction add(\n  $a,\n  $b\n) {\n  return $a + $b;\n}\n",
    name: "add",
    signature: "function add(\n  $a,\n  $b\n)",
  },
  {
    language: "python",
    source: "def add(\n    a,\n    b,\n):\n    return a + b\n",
    name: "add",
    signature: "def add(\n    a,\n    b,\n):",
  },
  {
    language: "python",
    source: "class Box(\n    Base,\n):\n    def grow(self):\n        pass\n",
    name: "Box",
    signature: "class Box(\n    Base,\n):",
  },
  {
    language: "bash",
    source: "add() {\n  echo $1\n}\n",
    name: "add",
    signature: "add()",
  },
];

describe("signatures: a definition's text up to the body its pattern marks", () => {
  for (const { language, source, name, signature } of CASES) {
    test(`${language}: ${name}`, async () => {
      const inventory = await decompose(source, language);
      const definition = inventory.definitions.find((d) => d.name === name);
      expect(definition?.signature).toBe(signature);
    });
  }
});

test("a definition without a body keeps its first line", async () => {
  const inventory = await decompose("const limits = {\n  rows: 12,\n};\n", "typescript");
  expect(inventory.definitions[0]?.signature).toBe("const limits = {");
});
