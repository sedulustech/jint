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

function decomposeTS(
  source: string,
  options: { readonly queries?: string } = {},
): Promise<Inventory> {
  return decompose(source, TS_LANG, options);
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
  test("declarations capture with their capture and their name", async () => {
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
      "d2 class Klass L4-L4",
      "d3 type Shape L5-L5",
      "d4 type Alias L6-L6",
      "d5 type Color L7-L7",
      "d6 binding bound L8-L8",
    ]);
  });

  test("a callable initializer keeps the function capture; other initializers are bindings", async () => {
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
      "class",
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
    expect(summary(inv)).toEqual(["d0 class Klass L2-L6", "d1 method method L3-L5 in d0"]);
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

  test("wrapper-call composites: test.each(...)() and skipIf are ONE function, callback absorbed", async () => {
    const inv = await decomposeTS(`
describe("store", () => {
  test.each([1, 2])("case %i", (n) => { expect(n).toBe(n); });
  test.skipIf(!hasBin)("bin", async () => { await run(); });
});
make.each([1])("not a family object", () => {});
`);
    // ONE element per wrapper call, named by the call (the callee family object); the inner
    // callback is an argument of the outer call and surfaces nowhere; a non-family object
    // (make.each) is not a composite at all - the name test holds for wrappers too
    expect(summary(inv)).toEqual([
      "d0 function describe L2-L5",
      "d1 function test L3-L3 in d0",
      "d2 function test L4-L4 in d0",
    ]);
    expect(inv.definitions.map((e) => e.name)).toEqual(["describe", "test", "test"]);
  });

  test("wrapper-first priority: a table OF callbacks cannot fork the element - the outer call wins", async () => {
    const inv = await decomposeTS(`
test.each([() => 1, () => 2])("case", (fn) => { fn(); });
`);
    // the inner test.each([...]) call matches the member pattern (its arguments hold arrows) and
    // the outer call matches the wrapper pattern; same-capture nesting keeps the OUTER element -
    // the php assigned-closure discipline, one logical element per call
    expect(summary(inv)).toEqual(["d0 function test L2-L2"]);
    expect(inv.definitions[0]!.content.startsWith("test.each")).toBe(true);
  });

  test("the @name container-binding trap is loud: one element carries one name", async () => {
    // (enum_body (property_identifier) @name) @binding matches once PER member - every match
    // carries a different member's name onto the SAME enum_body node; the guard names both and
    // the honest shapes (bind @name once, or one element per member)
    await expect(
      decomposeTS("enum Color { Red, Green }\n", {
        queries: "(enum_body (property_identifier) @name) @binding",
      }),
    ).rejects.toThrow(/query pattern 1 names one node twice \(Red, Green\)/);
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
    // argument, so none is a definition - the shape test is what makes the capture honest.
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
    expect(summary(inv)).toEqual(["d0 class Klass L2-L4", "d1 method method L3-L3 in d0"]);
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
    // the three-dimension model: attachment is extra structure, never a replacement for presence
    // - every comment text stays in the bucket, in document order
    expect(inv.comments.map((c) => c.content)).toEqual([
      "// first line",
      "// second line",
      "// detached",
      "// by a blank line",
    ]);
  });

  test("a same-row trailing comment attaches to nothing", async () => {
    // interface.c repro (L325-327): `static size_t qjs_mem_limit = 0; /* 0 = unlimited */` - the
    // note rides one row down onto the NEXT binding under a row-only gap; a comment that starts
    // on a row where the previous candidate ends is a note on THAT candidate, never a doc for
    // what follows
    const inv = await decomposeTS(`
const limit = 0; /* 0 = unlimited */
const used = 1;
`);
    expect(inv.definitions.map((d) => d.name)).toEqual(["limit", "used"]);
    expect(inv.definitions[1]!.attachedComment).toBeUndefined();
    expect(inv.comments[0]!.docstringOf).toBeUndefined();
  });

  test("equal-text comments own by identity, never by text", async () => {
    // process.cc repro (L466/L595): two identical comment texts - the second must not resolve
    // to the first's owner through a text match
    const inv = await decomposeTS(`
// utility
function first() {}

// utility
function second() {}
`);
    expect(inv.comments[0]!.docstringOf).toEqual({ kind: "function", name: "first" });
    expect(inv.comments[1]!.docstringOf).toEqual({ kind: "function", name: "second" });
  });

  test("the attached owner kind is the definition's own capture (lossless)", async () => {
    // cobra repro: go type/method doc comments are top-level runs - the old attached branch
    // collapsed every owner to class-or-function; the contract's DocstringOwner keeps all six
    // kinds (a class-body method docblock is a different shape: containment owns it to the class)
    const inv = await decomposeTS(`
/** Shape docs. */
interface Shape {}

/** Getter docs. */
function widget(): number {
  return 1;
}
`);
    expect(inv.comments[0]!.docstringOf).toEqual({ kind: "type", name: "Shape" });
    expect(inv.comments[1]!.docstringOf).toEqual({ kind: "function", name: "widget" });
  });

  test("a documented file keeps every comment in the bucket AND on the definitions", async () => {
    const inv = await decomposeTS(`
/** Module docs. */
function documented() {
  // internal note
  return 1;
}

// detached standalone

function bare() {}
`);
    expect(inv.comments.map((c) => c.content)).toEqual([
      "/** Module docs. */",
      "// internal note",
      "// detached standalone",
    ]);
    // the same texts are still carried as structure on their owners
    expect(inv.definitions[0]!.attachedComment).toEqual(["/** Module docs. */"]);
    expect(inv.definitions[0]!.internalCommentCount).toBe(1);
    expect(inv.definitions[1]!.attachedComment).toBeUndefined();
    expect(inv.definitions[1]!.internalCommentCount).toBe(0);
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
    // counted for EACH containing definition (the method and its class)...
    expect(klass.internalCommentCount).toBe(2);
    expect(method.internalCommentCount).toBe(1);
    // ...and still present in the bucket, once each, in document order
    expect(inv.comments.map((c) => c.content)).toEqual([
      "// inside the body",
      "// inside the method",
    ]);
  });

  test("a barrel file walks clean: re-exports are the import lane (the WALK_FAILED defect)", async () => {
    const inv = await decomposeTS("export * from './a.ts';\n");
    expect(inv.definitions).toEqual([]);
    expect(inv.comments).toEqual([]);
    expect(inv.imports).toHaveLength(1);
    expect(inv.imports[0]!.content).toBe("export * from './a.ts';");
  });

  test("named and type-only re-exports join the same import group", async () => {
    const inv = await decomposeTS(
      [
        "export { b } from './b.ts';",
        "export type { C } from './c.ts';",
        "export * as ns from './d.ts';",
      ].join("\n"),
    );
    expect(inv.definitions).toEqual([]);
    expect(inv.imports).toHaveLength(1);
    expect(inv.imports[0]!.content.split("\n")).toHaveLength(3);
  });

  test("a plain export without a source is NOT an import: it wraps its declaration", async () => {
    const inv = await decomposeTS("const a = 1;\nexport { a };\n");
    expect(inv.imports).toEqual([]);
    expect(inv.definitions.map((d) => [d.capture, d.name])).toEqual([["binding", "a"]]);
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

  test("scattered imports split per contiguous run: no element swallows code between", async () => {
    // the walk.ts repro: an export-from re-export AFTER code dragged the code into one
    // per-file merged span - a run ends at any non-import candidate or blank row
    const source = [
      'import a from "./a";',
      'import b from "./b";',
      "function between() {}",
      "export type T = 1;",
      'export { between } from "./b";',
      "",
    ].join("\n");
    const inv = await decomposeTS(source);
    expect(inv.imports).toHaveLength(2);
    expect(inv.imports.map((i) => [i.label, i.span.start.line, i.span.end.line])).toEqual([
      ["i0", 1, 2],
      ["i1", 5, 5],
    ]);
    // slice the span, get the content: the run never contains intervening source
    for (const element of inv.imports) {
      expect(element.content).toBe(source.slice(element.span.startByte, element.span.endByte));
    }
  });

  test("a partial parse still yields what parsed, flagged", async () => {
    const inv = await decomposeTS("function ok() {}\nfunction broken( {}\n");
    expect(inv.hasError).toBe(true);
    expect(inv.definitions.map((e) => e.name)).toEqual(["ok"]);
  });

  test("directives ride the engine channel to the walker: attach.gap and docstring.owner", async () => {
    // the full path: #set! in an .scm -> the engine's QueryMatch.setProperties -> Candidate
    // -> the walker's reads, with code defaults when absent
    const gapScm = [
      "((function_declaration name: (identifier) @name) @function",
      '  (#set! "attach.gap" "0"))',
      "(comment) @comment",
    ].join("\n");
    const source = "// doc\nfunction f() {}\n";
    const byDefault = await decompose(source, TS_LANG); // gap default 1: the comment attaches
    expect(byDefault.definitions[0]!.attachedComment).toEqual(["// doc"]);
    const withDirective = await decompose(source, TS_LANG, { queries: gapScm }); // gap 0: no run
    expect(withDirective.definitions[0]!.attachedComment).toBeUndefined();

    // docstring.owner "next": a module docstring owns the FOLLOWING definition, not the module
    const ownerScm = [
      "((function_definition name: (identifier) @name) @function)",
      "((module . (expression_statement (string) @docstring))",
      '  (#set! "docstring.owner" "next"))',
    ].join("\n");
    const py = '"""Module docs."""\ndef f():\n    return 1\n';
    const enclosing = await decompose(py, "python"); // default: the module owns it
    expect(enclosing.comments[0]!.docstringOf).toEqual({ kind: "module", name: "" });
    const next = await decompose(py, "python", { queries: ownerScm });
    expect(next.comments[0]!.docstringOf).toEqual({ kind: "function", name: "f" });
    expect(next.definitions[0]!.docstringCount).toBe(1);
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
