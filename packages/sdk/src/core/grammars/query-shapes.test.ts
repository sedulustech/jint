import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE query shape contract: one synthetic corpus (query-shapes.scm, a single-consumer fixture
 * beside this test) holding every place a comment can sit and every kind of node a pattern can hold
 * - a named node, a wildcard, a quoted node, an alternation, a grouping, a missing node, a field, a
 * nested node - and one inventory pinning every element. A capture inside a predicate's parameters
 * is no element, and a `;` inside a string is no comment.
 *
 * Why an exact inventory: a patched pattern or an engine change that moves one boundary or drops
 * one shape fails here by line and column, instead of surfacing as a silent change in what rules
 * judge.
 */

const FIXTURE = "query-shapes.scm";

// Line/column pairs are 1-based line, 0-based column. parent names the enclosing row's id.
const INVENTORY: readonly Row[] = [
  // file header: owned by the module
  { kind: "comment", start: [1, 0], end: [2, 42], owner: "module" },
  // a comment directly above a pattern documents that pattern
  { kind: "comment", start: [4, 0], end: [4, 27], owner: ["definition", ""] },
  // a pattern is a definition, and its root node has the same span
  { id: "pair", kind: "definition", start: [5, 0], end: [5, 45] },
  { id: "pairNode", kind: "node", start: [5, 0], end: [5, 45], name: "pair", parent: "pair" },
  // a field holds the node it names, and the node holds its capture
  { id: "keyField", kind: "field", start: [5, 6], end: [5, 19], name: "key", parent: "pairNode" },
  { id: "keyNode", kind: "node", start: [5, 11], end: [5, 19], name: "_", parent: "keyField" },
  { kind: "capture", start: [5, 15], end: [5, 19], name: "key", parent: "keyNode" },
  {
    id: "valueField",
    kind: "field",
    start: [5, 20],
    end: [5, 38],
    name: "value",
    parent: "pairNode",
  },
  { id: "valueNode", kind: "node", start: [5, 27], end: [5, 38], name: "_", parent: "valueField" },
  { kind: "capture", start: [5, 32], end: [5, 38], name: "value", parent: "valueNode" },
  // the capture of the root node sits inside the root node
  { kind: "capture", start: [5, 40], end: [5, 45], name: "pair", parent: "pairNode" },
  // a trailing comment after a pattern is its own element and documents nothing
  { kind: "comment", start: [5, 46], end: [5, 80] },
  { id: "note", kind: "definition", start: [6, 0], end: [6, 12] },
  { id: "noteNode", kind: "node", start: [6, 0], end: [6, 12], name: "note", parent: "note" },
  { kind: "capture", start: [6, 7], end: [6, 12], name: "note", parent: "noteNode" },
  { kind: "comment", start: [7, 0], end: [7, 74], owner: ["definition", ""] },
  // a quoted node is named by its text
  { id: "operator", kind: "definition", start: [8, 0], end: [8, 13] },
  { id: "operatorNode", kind: "node", start: [8, 0], end: [8, 13], name: "=", parent: "operator" },
  { kind: "capture", start: [8, 4], end: [8, 13], name: "operator", parent: "operatorNode" },
  // an alternation has no type, so it has no name, and its capture sits inside it
  { id: "alt", kind: "definition", start: [9, 0], end: [9, 15] },
  { id: "altNode", kind: "node", start: [9, 0], end: [9, 15], parent: "alt" },
  { kind: "node", start: [9, 1], end: [9, 4], name: "a", parent: "altNode" },
  { kind: "node", start: [9, 5], end: [9, 8], name: "b", parent: "altNode" },
  { kind: "capture", start: [9, 11], end: [9, 15], name: "alt", parent: "altNode" },
  // a grouping has no type either, and its predicate is no element
  { id: "group", kind: "definition", start: [10, 0], end: [10, 61] },
  { id: "groupNode", kind: "node", start: [10, 0], end: [10, 61], parent: "group" },
  { id: "cNode", kind: "node", start: [10, 1], end: [10, 17], name: "c", parent: "groupNode" },
  { id: "dNode", kind: "node", start: [10, 6], end: [10, 16], name: "d", parent: "cNode" },
  { kind: "capture", start: [10, 10], end: [10, 16], name: "inner", parent: "dNode" },
  { id: "missing", kind: "definition", start: [11, 0], end: [11, 29] },
  {
    id: "missingNode",
    kind: "node",
    start: [11, 0],
    end: [11, 29],
    name: "identifier",
    parent: "missing",
  },
  { kind: "capture", start: [11, 21], end: [11, 29], name: "missing", parent: "missingNode" },
  { id: "any", kind: "definition", start: [12, 0], end: [12, 8] },
  { id: "anyNode", kind: "node", start: [12, 0], end: [12, 8], name: "_", parent: "any" },
  { kind: "capture", start: [12, 4], end: [12, 8], name: "any", parent: "anyNode" },
  // a pattern over several rows is one definition, and a comment inside it belongs to it
  { id: "outer", kind: "definition", start: [14, 0], end: [16, 17] },
  { id: "outerNode", kind: "node", start: [14, 0], end: [16, 17], name: "outer", parent: "outer" },
  {
    kind: "comment",
    start: [15, 2],
    end: [15, 30],
    parent: "outerNode",
    owner: ["definition", ""],
  },
  {
    id: "innerNode",
    kind: "node",
    start: [16, 2],
    end: [16, 16],
    name: "inner",
    parent: "outerNode",
  },
  { kind: "capture", start: [16, 10], end: [16, 16], name: "inner", parent: "innerNode" },
  // a blank row splits comment runs into two elements
  { kind: "comment", start: [18, 0], end: [18, 28] },
  { kind: "comment", start: [20, 0], end: [20, 21], owner: ["definition", ""] },
  { id: "super", kind: "definition", start: [21, 0], end: [21, 16] },
  {
    id: "superNode",
    kind: "node",
    start: [21, 0],
    end: [21, 16],
    name: "f",
    parent: "super",
    diverges: {
      why: "a supertype node (e/f) is named by its subtype f; the pattern reads the first identifier",
      actual: { name: "e" },
    },
  },
  { kind: "capture", start: [21, 6], end: [21, 16], name: "supertype", parent: "superNode" },
  // a comment at the end of the file is a plain comment
  { kind: "comment", start: [22, 0], end: [22, 34] },
];

const ABSENCES: readonly Absence[] = [
  {
    line: 10,
    why: "a ; inside a string is string content, not a comment",
    kinds: ["comment"],
  },
  {
    line: 13,
    why: "a predicate is no definition, and its capture reference marks no node",
    kinds: ["definition", "node", "capture"],
  },
];

shapesSuite("query", FIXTURE, INVENTORY, ABSENCES, await captureShapes(FIXTURE));
