import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE toml shape contract: one synthetic corpus (toml-shapes.toml, a single-consumer fixture beside
 * this test) holding every place a comment can sit - header, above a table, trailing a pair or a
 * table header, inside a table, inside an array, at the end - and one inventory pinning every
 * element. toml captures comments only: tables and pairs are deliberate ABSENCES (queries.scm
 * WAITING ledger), and a
 *
 * # inside a string is no comment.
 *
 * Why an exact inventory: a patched pattern or an engine change that moves one boundary or drops
 * one shape fails here by line and column, instead of surfacing as a silent change in what rules
 * judge.
 */

const FIXTURE = "toml-shapes.toml";

// Line/column pairs are 1-based line, 0-based column. parent names the enclosing row's id.
const INVENTORY: readonly Row[] = [
  // file header: owned by the module
  { kind: "comment", start: [1, 0], end: [2, 42], owner: "module" },
  // toml has no definitions, so a comment above a table documents nothing
  { kind: "comment", start: [4, 0], end: [4, 25] },
  // a trailing comment after a pair is its own element and does not join the next row's comment
  { kind: "comment", start: [6, 16], end: [6, 47] },
  { kind: "comment", start: [7, 0], end: [7, 26] },
  // a trailing comment after a table header is its own element
  { kind: "comment", start: [11, 8], end: [11, 47] },
  { kind: "comment", start: [15, 24], end: [15, 64] },
  { kind: "comment", start: [17, 5], end: [17, 39] },
  // a lone comment inside an array is a plain comment
  { kind: "comment", start: [18, 2], end: [18, 34] },
  // a blank row splits comment runs into two elements
  { kind: "comment", start: [22, 0], end: [22, 28] },
  { kind: "comment", start: [24, 0], end: [24, 21] },
  // a comment at the end of the file is a plain comment, not the module's
  { kind: "comment", start: [26, 0], end: [26, 34] },
];

const ABSENCES: readonly Absence[] = [
  {
    line: 5,
    why: "a table is WAITING in the vocabulary: no capture",
    kinds: ["binding", "type", "class"],
  },
  { line: 6, why: "a pair is WAITING in the vocabulary: no capture", kinds: ["binding"] },
  { line: 9, why: "a # inside a string is string content, not a comment", kinds: ["comment"] },
];

shapesSuite("toml", FIXTURE, INVENTORY, ABSENCES, await captureShapes(FIXTURE));
