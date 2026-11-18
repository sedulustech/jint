import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE go shape contract: one synthetic corpus (go-shapes.go, a single-consumer fixture beside this
 * test) holding every way queries.scm lets a function, method, type, const/var binding, import,
 * test or comment be written, and one inventory pinning every element - kind, exact span, name,
 * parent, comment owner. The ABSENCES are the near-misses that must not capture (locals, literals,
 * subtests).
 *
 * Why an exact inventory: a patched pattern or an engine change that moves one boundary or drops
 * one shape fails here by line and column, instead of surfacing as a silent change in what rules
 * judge.
 */

const FIXTURE = "go-shapes.go";

// Line/column pairs are 1-based line, 0-based column. parent names the enclosing row's id.
const INVENTORY: readonly Row[] = [
  // the file header run is owned by the module; the build constraint below is a run of its own
  { kind: "comment", start: [1, 0], end: [2, 43], owner: "module" },
  { kind: "comment", start: [4, 0], end: [4, 16] },
  // a comment above the package clause documents no definition: the package clause is not one
  { kind: "comment", start: [6, 0], end: [6, 81] },
  // single and grouped import declarations, aliased, blank and dot forms, merge into one contiguous run
  { kind: "import", start: [9, 0], end: [15, 15] },
  // a doc comment directly above a const documents the binding
  { kind: "comment", start: [17, 0], end: [17, 38], owner: ["binding", "Pi"] },
  { kind: "binding", start: [18, 0], end: [18, 15], name: "Pi" },
  // a grouped block has several specs, so it is one nameless element
  { kind: "binding", start: [19, 0], end: [22, 1] },
  // a spec naming several identifiers keeps the first
  { kind: "binding", start: [23, 0], end: [23, 17], name: "x" },
  { kind: "binding", start: [24, 0], end: [24, 14], name: "global" },
  { kind: "binding", start: [25, 0], end: [28, 1] },
  { kind: "binding", start: [29, 0], end: [29, 12], name: "a" },
  { kind: "binding", start: [30, 0], end: [30, 21], name: "fnvar" },
  // a block comment directly above a type documents it
  { kind: "comment", start: [32, 0], end: [32, 48], owner: ["type", "Point"] },
  { kind: "type", start: [33, 0], end: [33, 29], name: "Point" },
  {
    kind: "type",
    start: [34, 0],
    end: [34, 16],
    name: "Alias",
    diverges: {
      why: "an alias declaration holds one spec, so it takes its name like a single-spec type; the alias is a type_alias node, not a type_spec, so the named pattern misses it",
      actual: { name: undefined },
    },
  },
  // a grouped type block is one nameless element
  { kind: "type", start: [35, 0], end: [38, 1] },
  { kind: "type", start: [39, 0], end: [39, 24], name: "Gen" },
  { kind: "type", start: [40, 0], end: [40, 22], name: "Handler" },
  { kind: "type", start: [41, 0], end: [41, 27], name: "Iface" },
  // a doc run is one comment element, documenting the function
  { kind: "comment", start: [43, 0], end: [44, 38], owner: ["function", "Add"] },
  { kind: "function", start: [45, 0], end: [45, 39], name: "Add" },
  // a receiver makes it a method: value, pointer, unnamed and generic receivers alike
  { kind: "method", start: [47, 0], end: [47, 42], name: "Dist" },
  { id: "Scale_48", kind: "method", start: [48, 0], end: [51, 1], name: "Scale" },
  {
    kind: "comment",
    start: [49, 1],
    end: [49, 29],
    parent: "Scale_48",
    owner: ["method", "Scale"],
  },
  {
    kind: "comment",
    start: [50, 10],
    end: [50, 40],
    parent: "Scale_48",
    owner: ["method", "Scale"],
  },
  { kind: "method", start: [52, 0], end: [52, 24], name: "NoName" },
  { kind: "method", start: [53, 0], end: [53, 27], name: "M" },
  { kind: "function", start: [54, 0], end: [54, 39], name: "Generic" },
  // a bodiless external declaration is still a function
  { kind: "function", start: [55, 0], end: [55, 24], name: "external" },
  { kind: "function", start: [56, 0], end: [56, 29], name: "init" },
  { kind: "function", start: [57, 0], end: [57, 29], name: "variadic" },
  { kind: "function", start: [58, 0], end: [58, 43], name: "multi" },
  { kind: "function", start: [59, 0], end: [64, 1], name: "main" },
  // func TestXxx(t *testing.T) is a test_case, opaque: t.Run closures are its body
  { kind: "test_case", start: [66, 0], end: [66, 29], name: "TestAdd" },
  // TestMain takes *testing.M, so it is no test
  { kind: "function", start: [67, 0], end: [67, 30], name: "TestMain" },
  { kind: "function", start: [68, 0], end: [68, 30], name: "Testify" },
  { kind: "test_case", start: [69, 0], end: [71, 1], name: "TestRun" },
  { kind: "test_case", start: [72, 0], end: [72, 32], name: "Test_snake" },
  { kind: "test_case", start: [73, 0], end: [73, 33], name: "Test9" },
  // a lowercase letter after Test is no test name
  { kind: "function", start: [74, 0], end: [74, 33], name: "Testlower" },
  // a testing.TB parameter is no *testing.T signature
  { kind: "function", start: [75, 0], end: [75, 33], name: "TestOther" },
  { kind: "function", start: [76, 0], end: [76, 33], name: "BenchmarkX" },
  { kind: "function", start: [77, 0], end: [77, 33], name: "ExampleX" },
  // a blank row splits comment runs into two elements
  { kind: "comment", start: [79, 0], end: [79, 29] },
  { kind: "comment", start: [81, 0], end: [81, 22], owner: ["function", "last"] },
  { kind: "function", start: [82, 0], end: [82, 14], name: "last" },
  { kind: "comment", start: [82, 15], end: [82, 53] },
];

const ABSENCES: readonly Absence[] = [
  {
    line: 60,
    why: "a short variable declaration inside a body is the body's own",
    kinds: ["binding"],
  },
  { line: 61, why: "a function literal inside a body is hidden", kinds: ["function"] },
  { line: 62, why: "a function literal inside a body is hidden", kinds: ["function"] },
  { line: 70, why: "a subtest closure is the test case's body", kinds: ["function"] },
];

shapesSuite("go", FIXTURE, INVENTORY, ABSENCES, await captureShapes(FIXTURE));
