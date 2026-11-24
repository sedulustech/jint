import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE yaml shape contract: one synthetic corpus (yaml-shapes.yaml, a single-consumer fixture beside
 * this test) holding every place a comment can sit - header, above a key, trailing a value, inside
 * a sequence or mapping, around a document marker, at the end - and one inventory pinning every
 * element. A key with its value is a pair, and a # inside a string or block scalar is no comment.
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
  // a pair owns no comment, so a comment above a key documents nothing
  { kind: "comment", start: [4, 0], end: [4, 23] },
  { kind: "pair", start: [5, 0], end: [5, 12], name: "name" },
  // a trailing comment after a value is its own element and does not join the next row's comment
  { kind: "comment", start: [5, 13], end: [5, 45] },
  // a pair holds its whole value, and the pairs of a mapping sit inside it
  { id: "list", kind: "pair", start: [6, 0], end: [9, 5], name: "list" },
  // a comment inside a sequence is a plain comment
  { kind: "comment", start: [7, 2], end: [7, 31], parent: "list" },
  { kind: "comment", start: [8, 6], end: [8, 38], parent: "list" },
  { id: "map", kind: "pair", start: [10, 0], end: [13, 10], name: "map" },
  { kind: "pair", start: [11, 2], end: [11, 41], name: "key", parent: "map" },
  { kind: "comment", start: [12, 2], end: [12, 30], parent: "map" },
  { kind: "pair", start: [13, 2], end: [13, 10], name: "other", parent: "map" },
  { kind: "pair", start: [14, 0], end: [16, 13], name: "text" },
  // a blank row splits comment runs into two elements
  { kind: "comment", start: [18, 0], end: [18, 28] },
  { kind: "comment", start: [20, 0], end: [20, 21] },
  // a document marker ends the run before it; a comment after it is not the module's
  { kind: "comment", start: [22, 0], end: [22, 35] },
  { kind: "pair", start: [23, 0], end: [23, 9], name: "second" },
  // a comment at the end of the file is a plain comment
  { kind: "comment", start: [24, 0], end: [24, 34] },
];

const ABSENCES: readonly Absence[] = [
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
