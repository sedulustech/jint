import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE typescript shape contract: one synthetic corpus (typescript-shapes.ts, a single-consumer
 * fixture beside this test) holding every way the grammar's queries.scm lets a construct be
 * written, and one inventory pinning every element it yields - kind, exact span, name, parent,
 * comment owner. The ABSENCES are the near-misses that must not capture.
 *
 * Why an exact inventory: a patched pattern or an engine change that moves one boundary or drops
 * one shape fails here by line and column, instead of surfacing as a silent change in what rules
 * judge.
 */

const FIXTURE = "typescript-shapes.ts";

// Line/column pairs are 1-based line, 0-based column. parent names the enclosing row's id.
const INVENTORY: readonly Row[] = [
  // file header run: ONE element, owned by the module, never by the import below
  { kind: "comment", start: [1, 0], end: [2, 43], owner: "module" },
  // contiguous imports merge into one run; the blank row at line 8 ends it
  { kind: "import", start: [4, 0], end: [7, 29] },
  // an import-equals is ONE import and joins the adjacent run (lines 9-12)
  { kind: "import", start: [9, 0], end: [12, 24] },
  // a doc comment directly above a definition documents it
  { kind: "comment", start: [15, 0], end: [15, 54], owner: ["function", "add"] },
  { id: "add_16", kind: "function", start: [16, 0], end: [18, 1], name: "add" },
  // a trailing comment inside a body: its own element, parented by the function
  { kind: "comment", start: [17, 16], end: [17, 49], parent: "add_16", owner: ["function", "add"] },
  { kind: "function", start: [19, 0], end: [19, 19], name: "plain" },
  { id: "fetchIt_20", kind: "function", start: [20, 0], end: [23, 1], name: "fetchIt" },
  {
    kind: "comment",
    start: [22, 2],
    end: [22, 33],
    parent: "fetchIt_20",
    owner: ["function", "fetchIt"],
  },
  { kind: "function", start: [24, 0], end: [26, 1], name: "gen" },
  { kind: "function", start: [27, 0], end: [27, 33], name: "exportedGen" },
  { kind: "function", start: [28, 0], end: [28, 40], name: "exportedAsync" },
  { kind: "function", start: [31, 0], end: [31, 36], name: "overloaded" },
  { id: "outer_33", kind: "function", start: [33, 0], end: [38, 1], name: "outer" },
  { kind: "function", start: [34, 2], end: [34, 21], name: "inner", parent: "outer_33" },
  { kind: "function", start: [35, 2], end: [35, 29], name: "innerArrow", parent: "outer_33" },
  { kind: "function", start: [40, 0], end: [40, 35], name: "arrow" },
  { kind: "function", start: [41, 0], end: [41, 50], name: "fnExpr" },
  { kind: "function", start: [42, 0], end: [42, 32], name: "asyncArrow" },
  { kind: "function", start: [43, 0], end: [43, 35], name: "oldStyle" },
  { kind: "function", start: [44, 0], end: [44, 23], name: "oldArrow" },
  { kind: "function", start: [45, 0], end: [45, 37], name: "exportedArrow" },
  { kind: "function", start: [46, 0], end: [46, 43], name: "exportedFnExpr" },
  { kind: "binding", start: [47, 0], end: [47, 32], name: "exportedConst" },
  { kind: "binding", start: [48, 0], end: [48, 27], name: "exportedVar" },
  { kind: "binding", start: [49, 0], end: [49, 23], name: "one" },
  { kind: "binding", start: [51, 0], end: [51, 29], name: "callResult" },
  // a trailing comment after code: its own element, no owner, no parent
  { kind: "comment", start: [51, 30], end: [51, 65] },
  { kind: "binding", start: [52, 0], end: [52, 43], name: "withMethods" },
  { kind: "binding", start: [53, 0], end: [53, 27], name: "ClassExpr" },
  { kind: "class", start: [55, 0], end: [55, 14], name: "Plain" },
  { kind: "class", start: [56, 0], end: [56, 24], name: "Exported" },
  { kind: "class", start: [57, 0], end: [59, 1], name: "Abs" },
  { kind: "class", start: [60, 0], end: [60, 36], name: "ExportedAbs" },
  { id: "WithMembers_61", kind: "class", start: [61, 0], end: [84, 1], name: "WithMembers" },
  { kind: "method", start: [64, 2], end: [66, 3], name: "constructor", parent: "WithMembers_61" },
  { kind: "method", start: [67, 2], end: [67, 13], name: "method", parent: "WithMembers_61" },
  { kind: "method", start: [68, 2], end: [68, 16], name: "sm", parent: "WithMembers_61" },
  { kind: "method", start: [69, 2], end: [69, 15], name: "am", parent: "WithMembers_61" },
  { kind: "method", start: [70, 2], end: [70, 10], name: "gm", parent: "WithMembers_61" },
  { kind: "method", start: [71, 2], end: [71, 23], name: "g", parent: "WithMembers_61" },
  { kind: "method", start: [72, 2], end: [72, 21], name: "g", parent: "WithMembers_61" },
  { kind: "method", start: [73, 2], end: [73, 19], name: "priv", parent: "WithMembers_61" },
  { kind: "method", start: [79, 2], end: [79, 27], name: "overload", parent: "WithMembers_61" },
  {
    kind: "comment",
    start: [80, 2],
    end: [80, 25],
    parent: "WithMembers_61",
    owner: ["method", "documented"],
  },
  { kind: "method", start: [81, 2], end: [83, 3], name: "documented", parent: "WithMembers_61" },
  { kind: "type", start: [86, 0], end: [86, 26], name: "I" },
  { kind: "type", start: [87, 0], end: [87, 22], name: "EI" },
  { kind: "type", start: [88, 0], end: [88, 21], name: "Alias2" },
  { kind: "type", start: [89, 0], end: [89, 28], name: "EAlias" },
  { kind: "type", start: [90, 0], end: [90, 12], name: "E" },
  { kind: "type", start: [91, 0], end: [91, 20], name: "EE" },
  { kind: "type", start: [92, 0], end: [92, 19], name: "CE" },
  { kind: "type", start: [93, 8], end: [93, 21], name: "DE" },
  { kind: "binding", start: [94, 8], end: [94, 25], name: "dc" },
  {
    kind: "function",
    start: [96, 2],
    end: [96, 27],
    name: "inNs",
    diverges: {
      why: "a namespace is a container declaration, not executable statements: its functions surface on their own (cpp namespace precedent); the engine reads it as an expression_statement and makes one opaque statement_group",
      actual: { kind: "statement_group", start: [95, 0], end: [97, 1], name: undefined },
    },
  },
  // a comment directly above a describe documents the suite
  { kind: "comment", start: [99, 0], end: [99, 39], owner: ["test_suite", ""] },
  { id: "test_suite_100", kind: "test_suite", start: [100, 0], end: [109, 2] },
  { kind: "test_case", start: [101, 2], end: [103, 4], parent: "test_suite_100" },
  { kind: "test_case", start: [104, 2], end: [104, 32], parent: "test_suite_100" },
  {
    kind: "function",
    start: [105, 2],
    end: [105, 22],
    name: "beforeEach",
    parent: "test_suite_100",
  },
  {
    id: "test_suite_106",
    kind: "test_suite",
    start: [106, 2],
    end: [108, 4],
    parent: "test_suite_100",
  },
  { kind: "test_case", start: [107, 4], end: [107, 26], parent: "test_suite_106" },
  { kind: "test_case", start: [110, 0], end: [110, 23] },
  { kind: "test_case", start: [111, 0], end: [111, 31] },
  { kind: "function", start: [112, 0], end: [112, 31], name: "test" },
  { kind: "test_case", start: [114, 0], end: [114, 39] },
  { kind: "test_suite", start: [115, 0], end: [115, 46] },
  { kind: "binding", start: [116, 0], end: [116, 30], name: "test2" },
  // adjacent top-level statements, blank rows and comments inside, are one group
  { id: "statement_group_118", kind: "statement_group", start: [118, 0], end: [137, 21] },
  {
    kind: "comment",
    start: [120, 7],
    end: [120, 44],
    parent: "statement_group_118",
    owner: ["statement_group", ""],
  },
  {
    kind: "comment",
    start: [121, 0],
    end: [121, 54],
    parent: "statement_group_118",
    owner: ["statement_group", ""],
  },
  // a blank row between comment and definition: loose, owned by nothing
  { kind: "comment", start: [139, 0], end: [139, 70] },
  { kind: "function", start: [141, 0], end: [141, 24], name: "afterGroup" },
  // a default export may be anonymous: the unit is the export's value, with no name
  { kind: "function", start: [143, 0], end: [143, 29] },
  { kind: "comment", start: [145, 0], end: [147, 24] },
  // a comment directly above an anonymous default class documents it
  { kind: "comment", start: [149, 0], end: [150, 22], owner: ["class", ""] },
  { kind: "class", start: [151, 0], end: [151, 23] },
  { kind: "function", start: [152, 0], end: [152, 24] },
];

const ABSENCES: readonly Absence[] = [
  { line: 13, why: "`export { local }` has no source: a wrapper over nothing, not a re-export" },
  { line: 29, why: "an overload signature is not a definition; only the implementation is" },
  { line: 30, why: "an overload signature is not a definition; only the implementation is" },
  { line: 32, why: "an ambient function signature has no body" },
  {
    line: 36,
    why: "a class inside a function body is hidden by the function's opacity",
    kinds: ["class"],
  },
  { line: 50, why: "a destructuring declarator has no single name: no binding" },
  { line: 58, why: "an abstract method signature is not a method_definition", kinds: ["method"] },
  { line: 62, why: "a class field is not a binding or a method" },
  { line: 63, why: "an arrow-valued class field is not a method" },
  {
    line: 74,
    why: "a private #name is not a property_identifier: not captured by the method pattern",
  },
  {
    line: 75,
    why: "a computed name is not a property_identifier: not captured by the method pattern",
  },
  {
    line: 76,
    why: "a string-literal name is not a property_identifier: not captured by the method pattern",
  },
  { line: 77, why: "a method overload signature is not a definition" },
  { line: 78, why: "a method overload signature is not a definition" },
  {
    line: 82,
    why: "a function inside a method is hidden by the method's opacity",
    kinds: ["function"],
  },
  { line: 102, why: "a binding inside a test case is its body, not a unit", kinds: ["binding"] },
  {
    line: 113,
    why: "a test call without a callback is no test and, by name, not a statement group",
  },
];

shapesSuite("typescript", FIXTURE, INVENTORY, ABSENCES, await captureShapes(FIXTURE));
