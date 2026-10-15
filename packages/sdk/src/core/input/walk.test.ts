/**
 * The walker tests: decompose over the typescript grammar (the first .scm port), plus the generic
 * policy seams every grammar rides - absorb, refinement, comment attachment, the imports merge,
 * parents, the size backstop. Per-grammar extraction tests land beside each grammar's port; the
 * parity corpora (tests/fixtures/parity/) carry the cross-walker comparison.
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_ELEMENT_TOKENS,
  charsToTokens,
  decompose,
  projectElement,
  type Inventory,
} from "./walk.ts";

const TS_LANG = "typescript";

function decomposeTS(source: string): Promise<Inventory> {
  return decompose(source, TS_LANG);
}

/** One line per element: label, capture, name, span - the shape assertions read. */
function summary(inventory: Inventory): string[] {
  return [...inventory.definitions, ...inventory.comments, ...inventory.imports].map(
    (e) =>
      `${e.label} ${e.capture} ${e.name ?? "-"} L${e.span.start.line}-L${e.span.end.line}` +
      (e.parent !== undefined ? ` in ${e.parent}` : ""),
  );
}

describe("decompose — typescript", () => {
  test("declarations capture with their noun and their name", async () => {
    const inv = await decomposeTS(`
function declared() {}
async function* gen() {}
class Klass {}
interface Shape { a: number }
type Alias = number;
enum Color { Red }
const bound = 5;
`);
    expect(summary(inv)).toEqual([
      "d0 function declared L2-L2",
      "d1 function gen L3-L3",
      "d2 type Klass L4-L4",
      "d3 type Shape L5-L5",
      "d4 type Alias L6-L6",
      "d5 type Color L7-L7",
      "d6 binding bound L8-L8",
    ]);
  });

  test("a callable initializer keeps the function noun; other initializers are bindings", async () => {
    const inv = await decomposeTS(`
const arrow = () => 1;
const expr = function () {};
const plain = 5;
let reassigned = 2;
`);
    expect(inv.definitions.map((e) => e.capture)).toEqual([
      "function",
      "function",
      "binding",
      "binding",
    ]);
    expect(inv.definitions.map((e) => e.name)).toEqual(["arrow", "expr", "plain", "reassigned"]);
  });

  test("absorb: the export wrapper is the element (span and content carry the prefix)", async () => {
    const inv = await decomposeTS(`
export function exported() {}
export class Klass {}
export const factory = () => 1;
export default function bare() {}
`);
    expect(inv.definitions.map((e) => e.capture)).toEqual([
      "function",
      "type",
      "function",
      "function",
    ]);
    for (const e of inv.definitions) expect(e.nodeType).toBe("export_statement");
    expect(inv.definitions[0]!.content.startsWith("export function")).toBe(true);
    expect(inv.definitions.map((e) => e.name)).toEqual(["exported", "Klass", "factory", "bare"]);
  });

  test("a nested function is a unit of its own: it surfaces as a child", async () => {
    const inv = await decomposeTS(`
function outer() {
  function inner() {}
}
`);
    expect(summary(inv)).toEqual(["d0 function outer L2-L4", "d1 function inner L3-L3 in d0"]);
  });

  test("a function interior hides different captures (locals) and shows same-capture ones", async () => {
    const inv = await decomposeTS(`
function outer() {
  const local = 1;
  function nested() {}
}
`);
    expect(summary(inv)).toEqual(["d0 function outer L2-L5", "d1 function nested L4-L4 in d0"]);
  });

  test("a type body surfaces: methods live inside their class", async () => {
    const inv = await decomposeTS(`
class Klass {
  method(): void {
    const inside = 1;
  }
}
`);
    expect(summary(inv)).toEqual(["d0 type Klass L2-L6", "d1 function method L3-L5 in d0"]);
  });

  test("call composites: describe/it/beforeEach capture as functions with parent links; the span carries the title line", async () => {
    const inv = await decomposeTS(`
describe("store", () => {
  let s: Store;
  beforeEach(() => { s = new Store(); });
  it("adds", () => { expect(s.add(1)).toBe(1); });
});
`);
    expect(summary(inv)).toEqual([
      "d0 function describe L2-L6",
      "d1 function beforeEach L4-L4 in d0",
      "d2 function it L5-L5 in d0",
    ]);
    expect(inv.definitions[0]!.content.startsWith('describe("store"')).toBe(true);
    expect(inv.definitions.map((e) => e.name)).toEqual(["describe", "beforeEach", "it"]);
  });

  test("call composites: the member-call variant (describe.only / it.skip) captures; non-family calls produce nothing", async () => {
    const inv = await decomposeTS(`
describe.only("outer", () => {
  it.skip("x", () => {});
});
const plain = compute(1);
expect(1).toBe(1);
compute(2);
`);
    expect(summary(inv)).toEqual([
      "d0 function describe L2-L4",
      "d1 function it L3-L3 in d0",
      "d2 binding plain L5-L5",
    ]);
  });

  test("call composites: name collisions without a callback are NOT functions", async () => {
    const inv = await decomposeTS(`
const obj = { toString(): string { return "x"; } };
obj.toString();
new Target().constructor("arg");
const test = 1;
test(1);
test("not a suite");
`);
    // every one of these carries a matching callee NAME; none carries a function-valued
    // argument, so none is a definition - the shape test is what makes the noun honest.
    // (The object literal's toString is a method_definition inside a binding: opaque interior.)
    expect(summary(inv)).toEqual(["d0 binding obj L2-L2", "d1 binding test L5-L5"]);
    expect(inv.definitions.every((d) => d.capture !== "function")).toBe(true);
  });

  test("different-capture overlap is legal: a method lives inside its class", async () => {
    const inv = await decomposeTS(`
class Klass {
  method(): void {}
}
`);
    expect(summary(inv)).toEqual(["d0 type Klass L2-L4", "d1 function method L3-L3 in d0"]);
  });

  test("unlisted nodes passthrough: a file of expressions yields nothing", async () => {
    const inv = await decomposeTS(`
const x = someCall(1, 2);
console.log(x);
if (x) { throw new Error("no"); }
`);
    expect(inv.definitions.map((e) => e.capture)).toEqual(["binding"]);
    expect(inv.comments).toEqual([]);
    expect(inv.imports).toEqual([]);
  });

  test("a leading comment run attaches to the directly following definition", async () => {
    const inv = await decomposeTS(`
// first line
// second line
function documented() {}

// detached
// by a blank line

const later = 1;
`);
    expect(inv.definitions[0]!.attachedComment).toEqual(["// first line", "// second line"]);
    expect(inv.definitions[1]!.attachedComment).toBeUndefined();
    expect(inv.comments.map((c) => c.content)).toEqual(["// detached", "// by a blank line"]);
  });

  test("comments inside a definition stay internal: counted, never duplicated", async () => {
    const inv = await decomposeTS(`
class Klass {
  // inside the body
  method(): void {
    // inside the method
  }
}
`);
    const klass = inv.definitions[0]!;
    const method = inv.definitions[1]!;
    expect(klass.internalCommentCount).toBe(2);
    expect(method.internalCommentCount).toBe(1);
    expect(inv.comments).toEqual([]);
  });

  test("imports merge into one element spanning the run", async () => {
    const inv = await decomposeTS(`
import { a } from "./a";
import b from "./b";
function after() {}
`);
    expect(inv.imports).toHaveLength(1);
    expect(inv.imports[0]!.label).toBe("i0");
    expect(inv.imports[0]!.content.split("\n")).toHaveLength(2);
    expect(inv.imports[0]!.span.start.line).toBe(2);
    expect(inv.imports[0]!.span.end.line).toBe(3);
  });

  test("a partial parse still yields what parsed, flagged", async () => {
    const inv = await decomposeTS("function ok() {}\nfunction broken( {}\n");
    expect(inv.hasError).toBe(true);
    expect(inv.definitions.map((e) => e.name)).toEqual(["ok"]);
  });

  test("the size backstop flags, never truncates", async () => {
    const huge = "const big = " + JSON.stringify("x".repeat(MAX_ELEMENT_TOKENS * 4)) + ";";
    const inv = await decomposeTS(huge);
    expect(charsToTokens(inv.definitions[0]!.content.length)).toBeGreaterThan(MAX_ELEMENT_TOKENS);
    expect(inv.definitions[0]!.oversized).toBe(true);
  });

  test("the wire projection keeps the contract union", async () => {
    const inv = await decomposeTS("function f() {}\nconst x = 1;\n// note\nimport a from './a';\n");
    const all = [...inv.definitions, ...inv.comments, ...inv.imports];
    const kinds = all.map((e) => projectElement(e).kind);
    expect(kinds).toEqual(["function", "binding", "comment", "import"]);
    expect((projectElement(inv.definitions[0]!) as { name?: string }).name).toBe("f");
  });
});

describe("provenance", () => {
  test("the embedded grammar records itself on every inventory", async () => {
    const inv = await decomposeTS("const x = 1;");
    expect(inv.provenance).toEqual({ source: "embedded" });
  });
});
