import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

/**
 * THE cpp shape contract: one synthetic corpus (cpp-shapes.cpp, a single-consumer fixture beside
 * this test) holding every way queries.scm lets a function, method, class, type, binding, include
 * or comment be written - in-class and out-of-line members, templates, namespaces, linkage blocks -
 * and one inventory pinning every element: kind, exact span, name, parent, comment owner. The
 * ABSENCES are the near-misses that must not capture (data members, aliases, using-directives).
 *
 * Why an exact inventory: a patched pattern or an engine change that moves one boundary or drops
 * one shape fails here by line and column, instead of surfacing as a silent change in what rules
 * judge.
 */

const FIXTURE = "cpp-shapes.cpp";

// Line/column pairs are 1-based line, 0-based column. parent names the enclosing row's id.
const INVENTORY: readonly Row[] = [
  // the file header run is owned by the module, never by the include below
  { kind: "comment", start: [1, 0], end: [2, 43], owner: "module" },
  { kind: "import", start: [4, 0], end: [6, 0] },
  // a namespace is transit: its functions surface on their own, unparented
  { kind: "function", start: [8, 0], end: [8, 25], name: "in_ns" },
  { kind: "function", start: [12, 0], end: [12, 27], name: "anon_ns" },
  // a declaration inside a linkage specification is a prototype function
  { kind: "function", start: [16, 0], end: [16, 19], name: "c_linked" },
  // a doc comment directly above a class documents it
  { kind: "comment", start: [19, 0], end: [19, 57], owner: ["class", "Widget"] },
  { id: "Widget_20", kind: "class", start: [20, 0], end: [45, 1], name: "Widget" },
  // in-class special members: constructors, destructors and operators are member functions
  {
    kind: "method",
    start: [22, 2],
    end: [22, 11],
    name: "Widget",
    parent: "Widget_20",
    diverges: {
      why: "a constructor, destructor, operator or member template is a member function (queries.scm: the member-function shapes are @method); its declarator is an identifier, destructor_name or operator_name rather than a field_identifier, so the free-function pattern claims it",
      actual: { kind: "function" },
    },
  },
  {
    kind: "method",
    start: [23, 2],
    end: [23, 26],
    name: "Widget",
    parent: "Widget_20",
    diverges: {
      why: "a constructor, destructor, operator or member template is a member function (queries.scm: the member-function shapes are @method); its declarator is an identifier, destructor_name or operator_name rather than a field_identifier, so the free-function pattern claims it",
      actual: { kind: "function" },
    },
  },
  {
    kind: "method",
    start: [24, 2],
    end: [24, 12],
    parent: "Widget_20",
    diverges: {
      why: "a constructor, destructor, operator or member template is a member function (queries.scm: the member-function shapes are @method); its declarator is an identifier, destructor_name or operator_name rather than a field_identifier, so the free-function pattern claims it",
      actual: { kind: "function" },
    },
  },
  {
    kind: "method",
    start: [25, 2],
    end: [25, 22],
    parent: "Widget_20",
    diverges: {
      why: "a constructor, destructor, operator or member template is a member function (queries.scm: the member-function shapes are @method); its declarator is an identifier, destructor_name or operator_name rather than a field_identifier, so the free-function pattern claims it",
      actual: { kind: "function" },
    },
  },
  // an in-class prototype is a method, definition or not
  { kind: "method", start: [26, 2], end: [26, 21], name: "proto", parent: "Widget_20" },
  {
    id: "inline_def_27",
    kind: "method",
    start: [27, 2],
    end: [29, 3],
    name: "inline_def",
    parent: "Widget_20",
  },
  // a comment inside a method body is parented by the method
  {
    kind: "comment",
    start: [28, 4],
    end: [28, 37],
    parent: "inline_def_27",
    owner: ["method", "inline_def"],
  },
  { kind: "method", start: [30, 2], end: [30, 31], name: "sm", parent: "Widget_20" },
  { kind: "method", start: [31, 2], end: [31, 26], name: "pure", parent: "Widget_20" },
  { kind: "method", start: [32, 2], end: [32, 31], name: "ov", parent: "Widget_20" },
  {
    kind: "method",
    start: [33, 2],
    end: [33, 36],
    parent: "Widget_20",
    diverges: {
      why: "a constructor, destructor, operator or member template is a member function (queries.scm: the member-function shapes are @method); its declarator is an identifier, destructor_name or operator_name rather than a field_identifier, so the free-function pattern claims it",
      actual: { kind: "function" },
    },
  },
  {
    kind: "method",
    start: [34, 2],
    end: [34, 46],
    parent: "Widget_20",
    diverges: {
      why: "a constructor, destructor, operator or member template is a member function (queries.scm: the member-function shapes are @method); its declarator is an identifier, destructor_name or operator_name rather than a field_identifier, so the free-function pattern claims it",
      actual: { kind: "function" },
    },
  },
  {
    kind: "method",
    start: [35, 2],
    end: [35, 44],
    name: "tmember",
    parent: "Widget_20",
    diverges: {
      why: "a constructor, destructor, operator or member template is a member function (queries.scm: the member-function shapes are @method); its declarator is an identifier, destructor_name or operator_name rather than a field_identifier, so the free-function pattern claims it",
      actual: { kind: "function" },
    },
  },
  // a friend declaration declares a free function, not a member
  { kind: "function", start: [36, 9], end: [36, 19], name: "fr", parent: "Widget_20" },
  // a nested class is a class element of its own
  {
    id: "Inner_39",
    kind: "class",
    start: [39, 2],
    end: [41, 3],
    name: "Inner",
    parent: "Widget_20",
  },
  { kind: "method", start: [40, 4], end: [40, 18], name: "deep", parent: "Inner_39" },
  { kind: "type", start: [42, 2], end: [42, 13], name: "S", parent: "Widget_20" },
  { kind: "type", start: [43, 2], end: [43, 20], name: "E", parent: "Widget_20" },
  { kind: "method", start: [44, 2], end: [44, 33], name: "last_method", parent: "Widget_20" },
  // an out-of-line definition is a method, named through its qualifier
  { kind: "method", start: [47, 0], end: [47, 29], name: "Widget::out_of_line" },
  { kind: "method", start: [48, 0], end: [48, 19], name: "Widget::Widget" },
  // a template is captured through its payload: the span carries the template header
  {
    kind: "class",
    start: [51, 0],
    end: [51, 41],
    name: "Box",
    diverges: {
      why: "a template class is named by its class (the template is captured through its payload for the span only); the payload pattern carries no @name, so it renders nameless",
      actual: { name: undefined },
    },
  },
  {
    kind: "type",
    start: [52, 0],
    end: [52, 35],
    name: "TS",
    diverges: {
      why: "a template struct is named by its struct; the payload pattern carries no @name, so it renders nameless",
      actual: { name: undefined },
    },
  },
  { kind: "function", start: [53, 0], end: [53, 51], name: "identity" },
  {
    kind: "function",
    start: [54, 0],
    end: [54, 37],
    name: "tproto",
    diverges: {
      why: "a template function prototype IS the function and absorbs its template header, as the definition above does; only definitions are wrapped, so the span starts at the inner declaration",
      actual: { start: [54, 22] },
    },
  },
  { kind: "class", start: [55, 0], end: [55, 30] },
  { kind: "class", start: [56, 0], end: [56, 32], name: "Derived" },
  // a forward declaration is no unit
  {
    kind: "class",
    start: [57, 0],
    end: [57, 9],
    name: "Fwd",
    unwanted:
      "a forward declaration is no unit (struct, union and enum need a body for exactly this reason); the class pattern's body is optional, so `class Fwd;` captures",
  },
  { kind: "type", start: [59, 0], end: [59, 23], name: "Point" },
  { kind: "type", start: [60, 0], end: [60, 21], name: "Bits" },
  { kind: "type", start: [61, 0], end: [61, 18], name: "Color" },
  { kind: "type", start: [62, 0], end: [62, 23], name: "Scoped" },
  { kind: "type", start: [63, 0], end: [63, 18], name: "myint" },
  // a typedef over a struct body is a type, and the struct it wraps surfaces as a child type
  { id: "Anon_64", kind: "type", start: [64, 0], end: [64, 31], name: "Anon" },
  { kind: "type", start: [64, 8], end: [64, 25], parent: "Anon_64" },
  { kind: "function", start: [68, 0], end: [68, 17], name: "helper" },
  { kind: "function", start: [69, 0], end: [69, 35], name: "sfn" },
  { kind: "function", start: [70, 0], end: [70, 30], name: "ifn" },
  { kind: "function", start: [71, 0], end: [71, 33], name: "cfn" },
  { kind: "function", start: [72, 0], end: [72, 36], name: "trailing" },
  // a lambda initializer is a binding here; the lambda is hidden by the binding's opacity
  { kind: "binding", start: [73, 0], end: [73, 35], name: "lam" },
  { kind: "function", start: [74, 0], end: [77, 1], name: "main" },
  { kind: "binding", start: [79, 0], end: [79, 10], name: "g" },
  { kind: "binding", start: [80, 0], end: [80, 20], name: "K" },
  { kind: "binding", start: [81, 0], end: [81, 24], name: "SC" },
  {
    kind: "binding",
    start: [82, 0],
    end: [82, 18],
    name: "pg",
    diverges: {
      why: "a pointer variable is state: a binding named pg; the state patterns match only a bare identifier declarator, so every pointer global yields nothing",
      actual: "absent",
    },
  },
  { kind: "binding", start: [83, 0], end: [83, 26], name: "first" },
  // a blank row splits comment runs into two elements
  { kind: "comment", start: [85, 0], end: [85, 32] },
  { kind: "comment", start: [87, 0], end: [87, 25], owner: ["function", "last"] },
  { kind: "function", start: [88, 0], end: [88, 28], name: "last" },
  { kind: "comment", start: [88, 29], end: [88, 59] },
  { id: "Tail_90", kind: "class", start: [90, 0], end: [93, 1], name: "Tail" },
  {
    kind: "comment",
    start: [91, 2],
    end: [91, 38],
    parent: "Tail_90",
    owner: ["method", "documented"],
  },
  { kind: "method", start: [92, 2], end: [92, 22], name: "documented", parent: "Tail_90" },
];

const ABSENCES: readonly Absence[] = [
  { line: 37, why: "a data member is neither state nor a type (the field capture is WAITING)" },
  { line: 38, why: "a using-alias is a type alias, not a binding: WAITING" },
  {
    line: 49,
    why: "a static member definition has a qualified declarator: no binding pattern matches",
  },
  { line: 65, why: "an alias declaration is WAITING in the vocabulary" },
  { line: 66, why: "a using-directive is no import" },
  {
    line: 75,
    why: "a lambda inside a function body is hidden by the function's opacity",
    kinds: ["function"],
  },
];

shapesSuite("cpp", FIXTURE, INVENTORY, ABSENCES, await captureShapes(FIXTURE));
