import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE yaml shape contract: one synthetic corpus (yaml-shapes.yaml, a single-consumer fixture beside
 * this test) holding every place a comment can sit - header, above a key, trailing a value, inside
 * a sequence or mapping, around a document marker, at the end - and one inventory pinning every
 * element. yaml captures comments only: mappings and keys are deliberate ABSENCES (queries.scm
 * WAITING ledger), and a # inside a string or block scalar is no comment.
 *
 * Why an exact inventory: a patched pattern or an engine change that moves one boundary or drops
 * one shape fails here by line and column, instead of surfacing as a silent change in what rules
 * judge.
 */

const FIXTURE = "yaml-shapes.yaml";

// Line/column pairs are 1-based line, 0-based column. parent names the enclosing row's id.
const INVENTORY: readonly Row[] = [
  // file header: owned by the module
  { kind: "comment", start: [1, 0], end: [2, 42], owner: "module" },
  // yaml has no definitions, so a comment above a key documents nothing
  { kind: "comment", start: [4, 0], end: [4, 23] },
  // a trailing comment after a value is its own element and does not join the next row's comment
  { kind: "comment", start: [5, 13], end: [5, 45] },
  // a comment inside a sequence is a plain comment
  { kind: "comment", start: [7, 2], end: [7, 31] },
  { kind: "comment", start: [8, 6], end: [8, 38] },
  { kind: "comment", start: [12, 2], end: [12, 30] },
  // a blank row splits comment runs into two elements
  { kind: "comment", start: [18, 0], end: [18, 28] },
  { kind: "comment", start: [20, 0], end: [20, 21] },
  // a document marker ends the run before it; a comment after it is not the module's
  { kind: "comment", start: [22, 0], end: [22, 35] },
  // a comment at the end of the file is a plain comment
  { kind: "comment", start: [24, 0], end: [24, 34] },
];

const ABSENCES: readonly Absence[] = [
  {
    line: 6,
    why: "a mapping key is WAITING in the vocabulary: no capture",
    kinds: ["binding", "type", "class"],
  },
  {
    line: 11,
    why: "a # inside a quoted string is string content, not a comment",
    kinds: ["comment"],
  },
  {
    line: 14,
    why: "a # inside a block scalar is scalar content, not a comment",
    kinds: ["comment"],
  },
];

shapesSuite("yaml", FIXTURE, INVENTORY, ABSENCES, await captureShapes(FIXTURE));
