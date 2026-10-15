; typescript: extraction patterns over the tree-sitter-typescript grammar.
;
; The capture vocabulary is jint-owned (see query.ts): @function @type @binding @comment @import
; name one element; @name names it (render-only). Span = captured node: a pattern that needs the
; wrapper absorbed captures the wrapper (export statements below).
;
; Pattern order is priority: when two patterns assign different captures to the same node, the
; earlier pattern wins — the callable-initializer refinement below depends on it.
;
; WAITING (recorded, not stretched — the five have no honest answer yet):

; - header-bounded class spans: elements carry their full node text now; the size backstop skips
;   what overflows.

; --- call composites: test constructs (jest/vitest) — ABSORB by callee AND shape ----------
; The whole call is the element: the span carries the title line (a describe('title', ...) span
; includes the describe line). Two conditions make a call honest as a function: the callee family
; (name predicate) AND a function-valued argument — a callback or arrow in the arguments. The
; shape test is what kills the collisions the name test alone lets through: a user-defined
; toString(), a constructor() call, or a shadowed `const test = 1; test(1)` all carry the
; matching TEXT but no callback, so they are no longer functions.
;
; KNOWN LIMIT (recorded, not solved): a shadowed name called WITH a callback
; (`const test = (x) => beep(x); test(1, () => {});`) is syntactically indistinguishable from a
; test construct — pattern predicates cannot see bindings. The limit is why this pattern is
; WAITING-to-retire behind the contextual-refinement tier.
;
; No @priority needed: no other pattern captures call_expression. The name is the callee (the
; title string as render name is the WAITING text-name capture, the same seam as markdown's).
(call_expression
  function: (identifier) @name
  arguments: (arguments [(arrow_function) (function_expression)])
  (#any-of? @name "describe" "it" "test" "beforeEach" "afterEach" "beforeAll" "afterAll")) @function
(call_expression
  function: (member_expression object: (identifier) @name)
  arguments: (arguments [(arrow_function) (function_expression)])
  (#any-of? @name "describe" "it" "test")) @function
; --- declarations: functions -----------------------------------------------------------------
(function_declaration name: (identifier) @name) @function
(generator_function_declaration name: (identifier) @name) @function
(method_definition name: (property_identifier) @name) @function

; Callable initializers keep the function noun (old refineCallableInitializers); any other
; lexical/variable declaration is a binding. Earlier patterns win (see header).
(lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function))) @function ; @priority
(lexical_declaration (variable_declarator name: (identifier) @name value: (function_expression))) @function ; @priority
(variable_declaration (variable_declarator name: (identifier) @name value: (arrow_function))) @function ; @priority
(variable_declaration (variable_declarator name: (identifier) @name value: (function_expression))) @function ; @priority
(lexical_declaration (variable_declarator name: (identifier) @name)) @binding ; @priority
(variable_declaration (variable_declarator name: (identifier) @name)) @binding ; @priority

; --- declarations: types ---------------------------------------------------------------------
(class_declaration name: (type_identifier) @name) @type
(abstract_class_declaration name: (type_identifier) @name) @type
(interface_declaration name: (type_identifier) @name) @type
(type_alias_declaration name: (type_identifier) @name) @type
(enum_declaration name: (identifier) @name) @type

; --- imports ----------------------------------------------------------------------------------
(import_statement) @import
(import_require_clause) @import
(import_alias) @import

; A RE-EXPORT is an import-lane item: `export * from './a'` / `export { b } from './b'` pulls
; names in from another module exactly as an import does, and it is the whole content of a barrel
; file. Without this pattern a barrel yields zero elements and the walk reports WALK_FAILED on a
; legal file - the real-jev dogfood defect. The `source:` field is what marks the re-export shape
; (a plain `export { a }` has no source and stays a wrapper over its declaration); the node type
; exists with this field in typescript and tsx only (node-types.json is the reference: python's
; from-import is already @import, go/php/c/cpp have no re-export-with-source shape).
(export_statement source: (_)) @import ; @priority

; --- comments ---------------------------------------------------------------------------------
(comment) @comment

; --- export wrappers: ABSORB ------------------------------------------------------------------
; The wrapper is the element: the span carries the "export" prefix, the inner declaration's
; bare pattern match is suppressed by same-capture nesting (see query.ts). Absorb = capture
; the wrapper; no walker unwrap step exists.
(export_statement declaration: (function_declaration name: (identifier) @name)) @function ; @priority
(export_statement declaration: (generator_function_declaration name: (identifier) @name)) @function ; @priority
(export_statement declaration: (class_declaration name: (type_identifier) @name)) @type ; @priority
(export_statement declaration: (abstract_class_declaration name: (type_identifier) @name)) @type ; @priority
(export_statement declaration: (interface_declaration name: (type_identifier) @name)) @type ; @priority
(export_statement declaration: (type_alias_declaration name: (type_identifier) @name)) @type ; @priority
(export_statement declaration: (enum_declaration name: (identifier) @name)) @type ; @priority
(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function)))) @function ; @priority
(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name value: (function_expression)))) @function ; @priority
(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @name value: (arrow_function)))) @function ; @priority
(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @name value: (function_expression)))) @function ; @priority
(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name))) @binding ; @priority
(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @name))) @binding ; @priority
