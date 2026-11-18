import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE json shape contract: one synthetic JSONC corpus (json-shapes.json, a single-consumer fixture
 * beside this test) holding every place a comment can sit - header, before the root, inside an
 * object, trailing a pair, inside an array, after a value, after the root - and one inventory
 * pinning every element. json captures comments only: objects, arrays and pairs are deliberate
 * ABSENCES (queries.scm WAITING ledger), asserted so a capture that starts claiming them fails
 * here.
 *
 * Why an exact inventory: a patched pattern or an engine change that moves one boundary or drops
 * one shape fails here by line and column, instead of surfacing as a silent change in what rules
 * judge.
 */

const FIXTURE = "json-shapes.json";

// Line/column pairs are 1-based line, 0-based column. parent names the enclosing row's id.
const INVENTORY: readonly Row[] = [
  // file header: owned by the module
  { kind: "comment", start: [1, 0], end: [2, 43], owner: "module" },
  // a block comment above the root documents nothing: json has no definitions
  { kind: "comment", start: [4, 0], end: [4, 37] },
  { kind: "comment", start: [6, 2], end: [6, 36] },
  // a trailing comment after a pair is its own element and does not join the next row's comment
  { kind: "comment", start: [7, 20], end: [7, 52] },
  { kind: "comment", start: [8, 2], end: [8, 37] },
  { kind: "comment", start: [10, 7], end: [10, 43] },
  // a doc-style block comment inside an array is a plain comment
  { kind: "comment", start: [11, 4], end: [11, 36] },
  // a comment between a value and its comma is a comment element
  { kind: "comment", start: [15, 14], end: [15, 43] },
  // a blank row splits comment runs into two elements
  { kind: "comment", start: [19, 2], end: [19, 31] },
  { kind: "comment", start: [21, 2], end: [21, 24] },
  // a comment after the root is a plain comment, not the module's
  { kind: "comment", start: [24, 0], end: [24, 27] },
];

const ABSENCES: readonly Absence[] = [
  { line: 5, why: "an object is data, not a unit", kinds: ["binding", "type", "class"] },
  {
    line: 7,
    why: "a pair is WAITING in the vocabulary: no capture",
    kinds: ["binding", "type", "class", "function", "method"],
  },
  { line: 9, why: "an array is data, not a unit", kinds: ["binding", "type", "class"] },
  { line: 22, why: "a scalar pair is no binding", kinds: ["binding"] },
];

shapesSuite("json", FIXTURE, INVENTORY, ABSENCES, await captureShapes(FIXTURE));
