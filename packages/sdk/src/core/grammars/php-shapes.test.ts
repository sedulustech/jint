import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE php shape contract: one synthetic corpus (php-shapes.php, a single-consumer fixture beside
 * this test) holding every way queries.scm lets a function, closure, method, class, interface,
 * trait, enum, binding, use declaration or comment be written, and one inventory pinning every
 * element - kind, exact span, name, parent, comment owner. The ABSENCES are the near-misses that
 * must not capture (require/include, properties, enum cases, plain statements). The corpus opens
 * with a shebang line because php scripts do.
 *
 * Why an exact inventory: a patched pattern or an engine change that moves one boundary or drops
 * one shape fails here by line and column, instead of surfacing as a silent change in what rules
 * judge.
 */

const FIXTURE = "php-shapes.php";

// Line/column pairs are 1-based line, 0-based column. parent names the enclosing row's id.
const INVENTORY: readonly Row[] = [
  // a // run and a # run are consecutive line comments: ONE element
  {
    kind: "comment",
    start: [3, 0],
    end: [4, 36],
    owner: "module",
  },
  // every use form (plain, group, function, const) merges into one contiguous run
  { kind: "import", start: [8, 0], end: [11, 20] },
  // a doc comment directly above a function documents it
  { kind: "comment", start: [16, 0], end: [16, 60], owner: ["function", "add"] },
  { id: "add_17", kind: "function", start: [17, 0], end: [20, 1], name: "add" },
  { kind: "comment", start: [18, 4], end: [18, 30], parent: "add_17", owner: ["function", "add"] },
  { kind: "comment", start: [19, 20], end: [19, 50], parent: "add_17", owner: ["function", "add"] },
  { kind: "function", start: [21, 0], end: [21, 20], name: "byref" },
  { kind: "function", start: [22, 0], end: [22, 65], name: "typed" },
  { kind: "function", start: [23, 0], end: [23, 27], name: "gen" },
  { id: "outer_24", kind: "function", start: [24, 0], end: [27, 1], name: "outer" },
  { kind: "function", start: [25, 4], end: [25, 23], name: "inner", parent: "outer_24" },
  // a closure assigned inside a function is a function of its own, named by its variable
  { kind: "function", start: [26, 4], end: [26, 29], name: "closure", parent: "outer_24" },
  // an assigned closure is ONE element: the assignment wrapper, named by the variable
  { kind: "function", start: [29, 0], end: [29, 48], name: "closure" },
  { kind: "function", start: [30, 0], end: [30, 25], name: "arrow" },
  { kind: "function", start: [31, 0], end: [31, 31], name: "static" },
  // an unassigned closure passed as an argument is a nameless function
  { kind: "function", start: [32, 10], end: [32, 38] },
  { kind: "function", start: [33, 10], end: [33, 22] },
  { kind: "binding", start: [34, 0], end: [34, 19], name: "result" },
  { kind: "binding", start: [35, 0], end: [35, 11], name: "x" },
  // a top-level const is a binding
  { kind: "binding", start: [36, 0], end: [36, 14], name: "TOP" },
  { kind: "binding", start: [37, 0], end: [37, 21], name: "A1" },
  { id: "Shape_40", kind: "type", start: [40, 0], end: [40, 43], name: "Shape" },
  // an interface method has no body and is still a method
  { kind: "method", start: [40, 18], end: [40, 41], name: "area", parent: "Shape_40" },
  { id: "Loud_41", kind: "type", start: [41, 0], end: [41, 41], name: "Loud" },
  { kind: "method", start: [41, 13], end: [41, 39], name: "shout", parent: "Loud_41" },
  { id: "Suit_42", kind: "type", start: [42, 0], end: [45, 1], name: "Suit" },
  // an enum's methods surface as methods of the enum
  { kind: "method", start: [44, 4], end: [44, 51], name: "label", parent: "Suit_42" },
  { id: "Base_46", kind: "class", start: [46, 0], end: [48, 1], name: "Base" },
  { kind: "method", start: [47, 4], end: [47, 34], name: "ab", parent: "Base_46" },
  { id: "Impl_49", kind: "class", start: [49, 0], end: [63, 1], name: "Impl" },
  // a class constant is a binding
  { kind: "binding", start: [51, 4], end: [51, 16], name: "X", parent: "Impl_49" },
  { kind: "method", start: [53, 4], end: [53, 50], name: "__construct", parent: "Impl_49" },
  { kind: "method", start: [54, 4], end: [54, 29], name: "area", parent: "Impl_49" },
  { kind: "method", start: [55, 4], end: [55, 34], name: "sm", parent: "Impl_49" },
  { kind: "method", start: [56, 4], end: [56, 36], name: "p", parent: "Impl_49" },
  { kind: "method", start: [57, 4], end: [57, 36], name: "priv", parent: "Impl_49" },
  {
    kind: "comment",
    start: [58, 4],
    end: [58, 40],
    parent: "Impl_49",
    owner: ["method", "documented"],
  },
  { kind: "method", start: [59, 4], end: [62, 5], name: "documented", parent: "Impl_49" },
  // an anonymous class is not a unit: the assignment is a binding, the class and its method are hidden
  { kind: "binding", start: [64, 0], end: [64, 45], name: "anon" },
  // a blank row splits comment runs into two elements
  { kind: "comment", start: [69, 0], end: [69, 29] },
  { kind: "comment", start: [71, 0], end: [71, 22], owner: ["function", "last"] },
  { kind: "function", start: [72, 0], end: [72, 18], name: "last" },
  { kind: "comment", start: [72, 19], end: [72, 57] },
];

const ABSENCES: readonly Absence[] = [
  { line: 13, why: "require_once is runtime control flow, not an import: transit" },
  { line: 14, why: "include is runtime control flow, not an import: transit" },
  { line: 38, why: "a call to define() is a statement, not a binding" },
  { line: 43, why: "an enum case is neither state nor a type" },
  { line: 52, why: "a property is member data: the field capture is WAITING" },
  {
    line: 60,
    why: "a local assignment in a body is hidden because the method is a leaf",
    kinds: ["binding"],
  },
  {
    line: 61,
    why: "an arrow in a body is hidden because the method is a leaf",
    kinds: ["function"],
  },
  { line: 66, why: "echo is a statement with no capture" },
  { line: 67, why: "control flow has no capture" },
];

shapesSuite("php", FIXTURE, INVENTORY, ABSENCES, await captureShapes(FIXTURE));
