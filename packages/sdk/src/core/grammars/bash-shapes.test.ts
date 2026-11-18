import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE bash shape contract: one synthetic corpus (bash-shapes.sh, a single-consumer fixture beside
 * this test) holding every way queries.scm lets a function, binding, import, comment or top-level
 * statement be written, and one inventory pinning every element - kind, exact span, name, parent,
 * comment owner. Each statement kind stands alone between two functions so its membership in the
 * statement group is proven by itself, not carried by a neighbour.
 *
 * Why an exact inventory: a patched pattern or an engine change that moves one boundary or drops
 * one shape fails here by line and column, instead of surfacing as a silent change in what rules
 * judge.
 */

const FIXTURE = "bash-shapes.sh";

// Line/column pairs are 1-based line, 0-based column. parent names the enclosing row's id.
const INVENTORY: readonly Row[] = [
  // the shebang is a comment node: it joins the header run into ONE element owned by the module
  { kind: "comment", start: [1, 0], end: [3, 42], owner: "module" },
  { kind: "import", start: [5, 0], end: [5, 15] },
  // a trailing comment on a source line splits the import run, as other source would
  { kind: "comment", start: [5, 16], end: [5, 50] },
  { kind: "import", start: [6, 0], end: [7, 22] },
  // top-level assignments and declaration forms are the script's bindings
  { kind: "binding", start: [9, 0], end: [9, 5], name: "VAR" },
  { kind: "binding", start: [10, 0], end: [10, 17], name: "EXPORTED" },
  { kind: "binding", start: [11, 0], end: [11, 13], name: "RO" },
  { kind: "binding", start: [12, 0], end: [12, 17], name: "DECL" },
  { kind: "binding", start: [13, 0], end: [13, 20], name: "ARR" },
  { kind: "binding", start: [15, 0], end: [15, 8], name: "COUNT" },
  // a comment directly above a function documents it
  { kind: "comment", start: [18, 0], end: [18, 52], owner: ["function", "greet"] },
  { id: "greet_19", kind: "function", start: [19, 0], end: [23, 1], name: "greet" },
  {
    kind: "comment",
    start: [20, 2],
    end: [20, 27],
    parent: "greet_19",
    owner: ["function", "greet"],
  },
  {
    kind: "comment",
    start: [22, 21],
    end: [22, 50],
    parent: "greet_19",
    owner: ["function", "greet"],
  },
  // `function name` without parentheses is the same function node as `name()`
  { kind: "function", start: [24, 0], end: [26, 1], name: "shout" },
  { kind: "function", start: [27, 0], end: [29, 1], name: "whisper" },
  { kind: "function", start: [30, 0], end: [30, 17], name: "oneliner" },
  { kind: "function", start: [31, 0], end: [33, 1], name: "subshelled" },
  // any compound command is a legal function body
  { kind: "function", start: [34, 0], end: [34, 31], name: "iffy" },
  { id: "outer_35", kind: "function", start: [35, 0], end: [38, 1], name: "outer" },
  // a function nested in a function surfaces as a child, like in every grammar
  { kind: "function", start: [36, 2], end: [36, 16], name: "inner", parent: "outer_35" },
  { kind: "function", start: [39, 0], end: [39, 29], name: "ns::qualified" },
  { kind: "function", start: [41, 0], end: [41, 11], name: "s0" },
  // each statement kind below stands alone between two functions, so each one's membership is proven
  { kind: "statement_group", start: [42, 0], end: [42, 13] },
  { kind: "function", start: [43, 0], end: [43, 11], name: "s1" },
  { kind: "statement_group", start: [44, 0], end: [44, 11] },
  { kind: "function", start: [45, 0], end: [45, 11], name: "s2" },
  { kind: "statement_group", start: [46, 0], end: [46, 27] },
  { kind: "function", start: [47, 0], end: [47, 11], name: "s3" },
  { kind: "statement_group", start: [48, 0], end: [50, 3] },
  { kind: "function", start: [51, 0], end: [51, 11], name: "s4" },
  { kind: "statement_group", start: [52, 0], end: [52, 19] },
  { kind: "function", start: [53, 0], end: [53, 11], name: "s5" },
  { kind: "statement_group", start: [54, 0], end: [54, 7] },
  { kind: "function", start: [55, 0], end: [55, 11], name: "s6" },
  { kind: "statement_group", start: [56, 0], end: [56, 15] },
  { kind: "function", start: [57, 0], end: [57, 11], name: "s7" },
  { kind: "statement_group", start: [58, 0], end: [58, 17] },
  { kind: "function", start: [59, 0], end: [59, 11], name: "s8" },
  { kind: "statement_group", start: [60, 0], end: [62, 2] },
  { kind: "function", start: [63, 0], end: [63, 11], name: "s9" },
  { kind: "statement_group", start: [64, 0], end: [66, 4] },
  { kind: "function", start: [67, 0], end: [67, 12], name: "s10" },
  { kind: "statement_group", start: [68, 0], end: [70, 4] },
  { kind: "function", start: [71, 0], end: [71, 12], name: "s11" },
  { kind: "statement_group", start: [72, 0], end: [74, 4] },
  { kind: "function", start: [75, 0], end: [75, 12], name: "s12" },
  { kind: "statement_group", start: [76, 0], end: [78, 4] },
  { kind: "function", start: [79, 0], end: [79, 12], name: "s13" },
  { kind: "statement_group", start: [80, 0], end: [80, 15] },
  { kind: "function", start: [81, 0], end: [81, 12], name: "s14" },
  { kind: "statement_group", start: [82, 0], end: [82, 27] },
  { kind: "function", start: [83, 0], end: [83, 12], name: "s15" },
  { kind: "statement_group", start: [84, 0], end: [84, 13] },
  { kind: "function", start: [85, 0], end: [85, 12], name: "s16" },
  { kind: "statement_group", start: [86, 0], end: [86, 33] },
  { kind: "function", start: [87, 0], end: [87, 12], name: "s17" },
  // adjacent statements join; a comment between them rides inside, one after the last ends outside
  { id: "statement_group_88", kind: "statement_group", start: [88, 0], end: [92, 11] },
  {
    kind: "comment",
    start: [90, 0],
    end: [90, 25],
    parent: "statement_group_88",
    owner: ["statement_group", ""],
  },
  { kind: "comment", start: [92, 12], end: [92, 43] },
  { kind: "function", start: [94, 0], end: [94, 14], name: "s_end" },
  // a blank row splits comment runs into two elements
  { kind: "comment", start: [96, 0], end: [96, 29] },
  { kind: "comment", start: [98, 0], end: [98, 21], owner: ["function", "final"] },
  { kind: "function", start: [99, 0], end: [99, 14], name: "final" },
];

const ABSENCES: readonly Absence[] = [
  { line: 14, why: "a declaration with no assignment binds no value: no binding" },
  {
    line: 16,
    why: "several assignments on one line parse as variable_assignments, which neither pattern matches",
  },
  {
    line: 21,
    why: "an assignment inside a function body is the function's implementation",
    kinds: ["binding"],
  },
  { line: 37, why: "a call inside a function body is hidden", kinds: ["statement_group"] },
];

shapesSuite("bash", FIXTURE, INVENTORY, ABSENCES, await captureShapes(FIXTURE));
