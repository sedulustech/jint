import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE c shape contract: one synthetic corpus (c-shapes.c, a single-consumer fixture beside this
 * test) holding every way queries.scm lets a function, prototype, type, binding, include or comment
 * be written, and one inventory pinning every element - kind, exact span, name, comment owner. The
 * ABSENCES are the near-misses that must not capture (macros, forward declarations).
 *
 * Why an exact inventory: a patched pattern or an engine change that moves one boundary or drops
 * one shape fails here by line and column, instead of surfacing as a silent change in what rules
 * judge.
 */

const FIXTURE = "c-shapes.c";

// Line/column pairs are 1-based line, 0-based column. parent names the enclosing row's id.
const INVENTORY: readonly Row[] = [
  // the file header run is owned by the module, never by the include below
  { kind: "comment", start: [1, 0], end: [2, 43], owner: "module" },
  // a preproc_include node carries its newline, so the run of includes ends at the next row's column 0
  { kind: "import", start: [4, 0], end: [7, 0] },
  // a doc comment directly above a definition documents it
  { kind: "comment", start: [12, 0], end: [12, 62], owner: ["function", "add"] },
  { id: "add_13", kind: "function", start: [13, 0], end: [16, 1], name: "add" },
  { kind: "comment", start: [14, 2], end: [14, 37], parent: "add_13", owner: ["function", "add"] },
  // a trailing comment after code: its own element, parented by the enclosing function
  { kind: "comment", start: [15, 16], end: [15, 46], parent: "add_13", owner: ["function", "add"] },
  // a prototype is a function unit, definition or not
  { kind: "function", start: [17, 0], end: [17, 24], name: "helper" },
  { kind: "function", start: [18, 0], end: [18, 21], name: "ptr_proto" },
  // a pointer declarator does not hide the name
  { kind: "function", start: [19, 0], end: [19, 31], name: "make" },
  {
    kind: "binding",
    start: [20, 0],
    end: [20, 18],
    name: "fnptr",
  },
  { kind: "function", start: [21, 0], end: [21, 16], name: "noargs" },
  { kind: "function", start: [22, 0], end: [22, 35], name: "variadic" },
  { kind: "function", start: [23, 0], end: [23, 42], name: "tiny" },
  { kind: "function", start: [24, 0], end: [24, 30], name: "extern_proto" },
  // K&R definitions are still function definitions
  { kind: "function", start: [25, 0], end: [25, 47], name: "old_style" },
  // a /// run is one comment element, documenting the struct below
  { kind: "comment", start: [27, 0], end: [28, 18], owner: ["type", "Point"] },
  { kind: "type", start: [29, 0], end: [32, 1], name: "Point" },
  // a variable of an anonymous struct type is a binding; its struct is hidden because the binding is a leaf
  { kind: "binding", start: [34, 0], end: [34, 27], name: "anon_var" },
  // a typedef over a struct body is a type, and the struct it wraps surfaces as a child type
  { id: "Anon_35", kind: "type", start: [35, 0], end: [35, 31], name: "Anon" },
  { kind: "type", start: [35, 8], end: [35, 25], parent: "Anon_35" },
  { id: "Node_36", kind: "type", start: [36, 0], end: [36, 36], name: "Node" },
  { kind: "type", start: [36, 8], end: [36, 30], name: "Node", parent: "Node_36" },
  { kind: "type", start: [37, 0], end: [37, 18], name: "myint" },
  // function-pointer and anonymous shapes carry no name: a missing name is honest, a wrong one is not
  { kind: "type", start: [38, 0], end: [38, 29] },
  { kind: "type", start: [39, 0], end: [39, 23], name: "string_t" },
  { kind: "type", start: [40, 0], end: [43, 1], name: "Bits" },
  { kind: "type", start: [44, 0], end: [44, 25], name: "Color" },
  { kind: "type", start: [45, 0], end: [45, 15] },
  { kind: "binding", start: [47, 0], end: [47, 15], name: "global" },
  { kind: "binding", start: [48, 0], end: [48, 11], name: "uninit" },
  {
    kind: "binding",
    start: [49, 0],
    end: [49, 22],
    name: "msg",
  },
  {
    kind: "binding",
    start: [50, 0],
    end: [50, 30],
    name: "counter",
  },
  { kind: "binding", start: [51, 0], end: [51, 26], name: "first" },
  { kind: "binding", start: [52, 0], end: [52, 15], name: "ext" },
  {
    kind: "binding",
    start: [53, 0],
    end: [53, 25],
    name: "table",
  },
  {
    kind: "binding",
    start: [54, 0],
    end: [54, 13],
    name: "zeros",
  },
  // a blank row splits comment runs into two elements
  { kind: "comment", start: [56, 0], end: [56, 32] },
  { kind: "comment", start: [58, 0], end: [58, 25], owner: ["function", "last"] },
  { kind: "function", start: [59, 0], end: [59, 28], name: "last" },
];

const ABSENCES: readonly Absence[] = [
  { line: 8, why: "a macro is invisible to the grammar: preprocessor" },
  { line: 9, why: "a conditional-compilation directive is no element" },
  { line: 33, why: "a struct without a body is a forward declaration, not a type" },
];

shapesSuite("c", FIXTURE, INVENTORY, ABSENCES, await captureShapes(FIXTURE));
