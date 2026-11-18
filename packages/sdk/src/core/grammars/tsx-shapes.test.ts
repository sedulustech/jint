import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE tsx shape contract: the typescript shapes as they appear in components - function and arrow
 * components, JSX bodies and attributes, a JSX comment child, a class component - pinned as one
 * inventory over tsx-shapes.tsx (a single-consumer fixture beside this test), with the near-misses
 * asserted as absences. The tsx grammar shares typescript's queries.scm, so this proves the node
 * vocabulary holds under JSX.
 */

const FIXTURE = "tsx-shapes.tsx";

// Line/column pairs are 1-based line, 0-based column. parent names the enclosing row's id.
const INVENTORY: readonly Row[] = [
  // file header: owned by the module
  { kind: "comment", start: [1, 0], end: [1, 38], owner: "module" },
  { kind: "import", start: [2, 0], end: [3, 32] },
  // a doc comment above a component documents it
  { kind: "comment", start: [5, 0], end: [5, 71], owner: ["function", "Card"] },
  { id: "Card_6", kind: "function", start: [6, 0], end: [9, 1], name: "Card" },
  { kind: "comment", start: [7, 2], end: [7, 38], parent: "Card_6", owner: ["function", "Card"] },
  // a trailing comment after JSX is its own element inside the component
  { kind: "comment", start: [8, 46], end: [8, 75], parent: "Card_6", owner: ["function", "Card"] },
  { kind: "function", start: [10, 0], end: [12, 1], name: "Plain" },
  { kind: "function", start: [13, 0], end: [13, 46], name: "Arrow" },
  { id: "Typed_14", kind: "function", start: [14, 0], end: [16, 2], name: "Typed" },
  // a comment child inside JSX is still a comment element, owned by the enclosing function
  {
    kind: "comment",
    start: [15, 19],
    end: [15, 44],
    parent: "Typed_14",
    owner: ["function", "Typed"],
  },
  { kind: "binding", start: [17, 0], end: [19, 3], name: "Memo" },
  { kind: "binding", start: [20, 0], end: [20, 42], name: "element" },
  { id: "Page_21", kind: "function", start: [21, 0], end: [24, 1], name: "Page" },
  { kind: "function", start: [22, 2], end: [22, 30], name: "handler", parent: "Page_21" },
  { id: "Legacy_26", kind: "class", start: [26, 0], end: [32, 1], name: "Legacy" },
  { kind: "method", start: [28, 2], end: [28, 24], name: "componentDidMount", parent: "Legacy_26" },
  { kind: "method", start: [29, 2], end: [31, 3], name: "render", parent: "Legacy_26" },
  { kind: "type", start: [34, 0], end: [34, 29], name: "Props" },
  { kind: "type", start: [35, 0], end: [35, 35], name: "Alias" },
  { kind: "type", start: [36, 0], end: [36, 16], name: "Mode" },
  { id: "test_suite_38", kind: "test_suite", start: [38, 0], end: [42, 2] },
  { kind: "test_case", start: [39, 2], end: [41, 4], parent: "test_suite_38" },
  // a top-level call is a statement group, JSX arguments and all
  { kind: "statement_group", start: [44, 0], end: [44, 17] },
];

const ABSENCES: readonly Absence[] = [
  {
    line: 17,
    why: "a function expression inside a call initializer is hidden by the binding's opacity",
    kinds: ["function"],
  },
  { line: 27, why: "a class field is not a binding or a method" },
  {
    line: 30,
    why: "an arrow in a JSX attribute inside a method is hidden by the method's opacity",
    kinds: ["function"],
  },
  { line: 40, why: "a call inside a test case is its body" },
];

shapesSuite("tsx", FIXTURE, INVENTORY, ABSENCES, await captureShapes(FIXTURE));
