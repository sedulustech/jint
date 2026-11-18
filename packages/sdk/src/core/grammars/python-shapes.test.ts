import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE python shape contract: one synthetic corpus (python-shapes.py, a single-consumer fixture
 * beside this test) holding every way queries.scm lets a def, class, import, docstring, comment or
 * test be written, and one inventory pinning every element - kind, exact span, name, parent,
 * comment owner. The ABSENCES are the near-misses that must not capture (assignments, lambdas,
 * stray strings).
 *
 * Why an exact inventory: a patched pattern or an engine change that moves one boundary or drops
 * one shape fails here by line and column, instead of surfacing as a silent change in what rules
 * judge.
 */

const FIXTURE = "python-shapes.py";

// Line/column pairs are 1-based line, 0-based column. parent names the enclosing row's id.
const INVENTORY: readonly Row[] = [
  // the shebang is a comment node: it joins the header run into ONE element owned by the module
  { kind: "comment", start: [1, 0], end: [3, 42], owner: "module" },
  // the module docstring is the first STATEMENT: a header comment above it does not hide it
  { kind: "comment", start: [5, 0], end: [5, 43], owner: "module" },
  // every import form merges into one contiguous run
  { kind: "import", start: [7, 0], end: [12, 12] },
  // a comment run directly above a definition documents it
  { kind: "comment", start: [18, 0], end: [19, 27], owner: ["function", "plain"] },
  { kind: "function", start: [20, 0], end: [21, 8], name: "plain" },
  { id: "documented_24", kind: "function", start: [24, 0], end: [27, 47], name: "documented" },
  // a docstring is a comment element owned by its definition
  {
    kind: "comment",
    start: [25, 4],
    end: [25, 29],
    parent: "documented_24",
    owner: ["function", "documented"],
  },
  {
    kind: "comment",
    start: [26, 4],
    end: [26, 29],
    parent: "documented_24",
    owner: ["function", "documented"],
  },
  {
    kind: "comment",
    start: [27, 18],
    end: [27, 47],
    parent: "documented_24",
    owner: ["function", "documented"],
  },
  { id: "fetch_30", kind: "function", start: [30, 0], end: [32, 17], name: "fetch" },
  {
    kind: "comment",
    start: [31, 4],
    end: [31, 55],
    parent: "fetch_30",
    owner: ["function", "fetch"],
  },
  {
    id: "commented_first_35",
    kind: "function",
    start: [35, 0],
    end: [38, 12],
    name: "commented_first",
  },
  // a comment before the docstring does not hide the docstring
  {
    kind: "comment",
    start: [36, 4],
    end: [36, 36],
    parent: "commented_first_35",
    owner: ["function", "commented_first"],
  },
  {
    kind: "comment",
    start: [37, 4],
    end: [37, 43],
    parent: "commented_first_35",
    owner: ["function", "commented_first"],
  },
  { kind: "function", start: [41, 0], end: [42, 11], name: "generator" },
  { id: "outer_45", kind: "function", start: [45, 0], end: [48, 16], name: "outer" },
  { kind: "function", start: [46, 4], end: [47, 12], name: "inner", parent: "outer_45" },
  { kind: "function", start: [51, 0], end: [54, 12], name: "not_a_docstring" },
  // the decorator prefix travels with the function: the span starts at the decorator
  { kind: "function", start: [57, 0], end: [59, 8], name: "decorated" },
  { kind: "function", start: [62, 0], end: [65, 8], name: "stacked" },
  { kind: "class", start: [68, 0], end: [69, 8], name: "Plain" },
  // a decorated class absorbs its decorator line
  { id: "Decorated_72", kind: "class", start: [72, 0], end: [105, 12], name: "Decorated" },
  {
    kind: "comment",
    start: [74, 4],
    end: [74, 26],
    parent: "Decorated_72",
    owner: ["class", "Decorated"],
  },
  { kind: "method", start: [78, 4], end: [79, 18], name: "__init__", parent: "Decorated_72" },
  {
    id: "method_81",
    kind: "method",
    start: [81, 4],
    end: [84, 16],
    name: "method",
    parent: "Decorated_72",
  },
  {
    kind: "comment",
    start: [82, 8],
    end: [82, 31],
    parent: "method_81",
    owner: ["method", "method"],
  },
  { kind: "method", start: [86, 4], end: [88, 12], name: "static", parent: "Decorated_72" },
  { kind: "method", start: [90, 4], end: [92, 16], name: "prop", parent: "Decorated_72" },
  { kind: "method", start: [94, 4], end: [95, 12], name: "amethod", parent: "Decorated_72" },
  // a class nested mid-body is a class element of its own
  {
    id: "Nested_97",
    kind: "class",
    start: [97, 4],
    end: [99, 16],
    name: "Nested",
    parent: "Decorated_72",
  },
  { kind: "method", start: [98, 8], end: [99, 16], name: "inner_method", parent: "Nested_97" },
  { kind: "method", start: [101, 4], end: [102, 12], name: "after_nested", parent: "Decorated_72" },
  {
    kind: "class",
    start: [104, 4],
    end: [105, 12],
    name: "LastMember",
    parent: "Decorated_72",
  },
  // def test_* is a test_case, opaque: its helper is not a unit
  { kind: "test_case", start: [108, 0], end: [110, 12], name: "test_plain" },
  { kind: "test_case", start: [113, 0], end: [114, 8], name: "test_async" },
  { kind: "test_case", start: [117, 0], end: [118, 8], name: "testCamel" },
  // a bare `test` is not a test: the name needs a separator or capital after it
  { kind: "function", start: [121, 0], end: [122, 8], name: "test" },
  { kind: "function", start: [125, 0], end: [126, 8], name: "testing" },
  { kind: "test_case", start: [129, 0], end: [131, 8], name: "test_decorated" },
  { id: "TestCase_134", kind: "class", start: [134, 0], end: [143, 12], name: "TestCase" },
  {
    kind: "test_case",
    start: [135, 4],
    end: [136, 12],
    name: "test_method",
    parent: "TestCase_134",
  },
  {
    kind: "test_case",
    start: [138, 4],
    end: [140, 12],
    name: "test_static",
    parent: "TestCase_134",
  },
  { kind: "method", start: [142, 4], end: [143, 12], name: "helper", parent: "TestCase_134" },
  // a blank row splits comment runs into two elements
  { kind: "comment", start: [146, 0], end: [146, 29] },
  { kind: "comment", start: [148, 0], end: [148, 21] },
  { id: "Tail_154", kind: "class", start: [154, 0], end: [157, 12], name: "Tail" },
  {
    kind: "comment",
    start: [155, 4],
    end: [155, 30],
    parent: "Tail_154",
    owner: ["method", "documented"],
  },
  { kind: "method", start: [156, 4], end: [157, 12], name: "documented", parent: "Tail_154" },
  // a nested class that ends its parent still surfaces: last, decorated, only member, deep
  { kind: "comment", start: [160, 0], end: [160, 91], owner: ["class", "EndsWithClass"] },
  {
    id: "EndsWithClass_161",
    kind: "class",
    start: [161, 0],
    end: [167, 12],
    name: "EndsWithClass",
  },
  { kind: "method", start: [162, 4], end: [163, 12], name: "method", parent: "EndsWithClass_161" },
  {
    kind: "class",
    start: [165, 4],
    end: [167, 12],
    name: "DecoratedLast",
    parent: "EndsWithClass_161",
  },
  { kind: "function", start: [170, 0], end: [174, 12], name: "ends_with_local_class" },
  {
    id: "DecoratedOuter_177",
    kind: "class",
    start: [177, 0],
    end: [180, 12],
    name: "DecoratedOuter",
  },
  {
    kind: "class",
    start: [179, 4],
    end: [180, 12],
    name: "OnlyMember",
    parent: "DecoratedOuter_177",
  },
  { id: "Deep_183", kind: "class", start: [183, 0], end: [186, 16], name: "Deep" },
  {
    id: "Middle_184",
    kind: "class",
    start: [184, 4],
    end: [186, 16],
    name: "Middle",
    parent: "Deep_183",
  },
  { kind: "class", start: [185, 8], end: [186, 16], name: "Innermost", parent: "Middle_184" },
];

const ABSENCES: readonly Absence[] = [
  { line: 14, why: "an assignment is not a binding in python" },
  { line: 15, why: "a lambda assigned to a name is not a function" },
  { line: 53, why: "a string that is not the first statement is not a docstring" },
  {
    line: 83,
    why: "a function inside a method is hidden by the method's opacity",
    kinds: ["function"],
  },
  { line: 109, why: "a helper inside a test case is its body", kinds: ["function"] },
  { line: 150, why: "top-level control flow has no capture in python" },
  { line: 151, why: "a call inside it has no capture either" },
  {
    line: 173,
    why: "a class inside a function is hidden by the function's opacity",
    kinds: ["class"],
  },
];

shapesSuite("python", FIXTURE, INVENTORY, ABSENCES, await captureShapes(FIXTURE));
