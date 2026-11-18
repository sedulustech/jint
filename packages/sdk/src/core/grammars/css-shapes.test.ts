import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE css shape contract: one synthetic corpus (css-shapes.css, a single-consumer fixture beside
 * this test) holding every place a comment can sit in a stylesheet - header, above a rule, trailing
 * a declaration, inside a rule, inside a value, inside an at-rule, multi-line - and one inventory
 * pinning every element. css captures comments only: rules, declarations, at-rules and @import are
 * deliberate ABSENCES (queries.scm WAITING ledger), asserted so a capture that starts claiming them
 * fails here.
 *
 * Why an exact inventory: a patched pattern or an engine change that moves one boundary or drops
 * one shape fails here by line and column, instead of surfacing as a silent change in what rules
 * judge.
 */

const FIXTURE = "css-shapes.css";

// Line/column pairs are 1-based line, 0-based column. parent names the enclosing row's id.
const INVENTORY: readonly Row[] = [
  // file header: owned by the module
  { kind: "comment", start: [1, 0], end: [2, 46], owner: "module" },
  // css has no definitions, so a doc-style comment above a rule documents nothing
  { kind: "comment", start: [8, 0], end: [8, 40] },
  // a trailing comment after a declaration is its own element, and does not join the next row's comment
  { kind: "comment", start: [10, 14], end: [10, 56] },
  { kind: "comment", start: [11, 2], end: [11, 31] },
  // a comment inside a value is still a comment element
  { kind: "comment", start: [12, 12], end: [12, 42] },
  // a blank row splits comment runs into two elements
  { kind: "comment", start: [15, 0], end: [15, 32] },
  { kind: "comment", start: [17, 0], end: [17, 25] },
  { kind: "comment", start: [19, 2], end: [19, 35] },
  { kind: "comment", start: [28, 33], end: [28, 68] },
  // a multi-line block comment is one element
  { kind: "comment", start: [29, 0], end: [32, 3] },
];

const ABSENCES: readonly Absence[] = [
  { line: 4, why: "@charset is a statement, not a comment" },
  {
    line: 5,
    why: "@import is not an import capture: css imports are not code imports (queries.scm WAITING)",
    kinds: ["import"],
  },
  { line: 6, why: "@import with a media query is not an import capture either", kinds: ["import"] },
  { line: 9, why: "a rule set has no capture" },
  { line: 10, why: "a declaration has no capture", kinds: ["binding", "function", "type"] },
  { line: 18, why: "@media is a container with no capture" },
  { line: 23, why: "@keyframes is a container with no capture" },
  { line: 27, why: "a custom-property rule has no capture" },
];

shapesSuite("css", FIXTURE, INVENTORY, ABSENCES, await captureShapes(FIXTURE));
