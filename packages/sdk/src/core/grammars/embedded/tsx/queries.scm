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

; WRAPPER-CALL composites - the data-driven and conditional families: test.each(table)('title',
; fn), describe.each(...)('title', fn), test.skipIf(cond)('title', fn) (and runIf, only, skip -
; every .modifier of the family). The outer call's CALLEE is the inner test.each(...) call, so the
; plain patterns above cannot see it: without this pattern the whole wrapper vanishes (the inner
; call's arguments hold the table, never a callback; the callback is an argument of the OUTER
; call). Wrapper-first, the php assigned-closure discipline: the OUTER call is THE one @function -
; span carries the title line, @name the callee family object ("test") - and the inner callback is
; absorbed (a same-capture nest under the wrapper, when anything captures it at all). The shape
; test rides here too: the outer arguments must hold the callback.
(call_expression
  function: (call_expression
    function: (member_expression object: (identifier) @name))
  arguments: (arguments [(arrow_function) (function_expression)])
  (#any-of? @name "describe" "it" "test")) @function
(call_expression
  function: (member_expression object: (identifier) @name)
  arguments: (arguments [(arrow_function) (function_expression)])
  (#any-of? @name "describe" "it" "test")) @function
; --- declarations: functions -----------------------------------------------------------------
(function_declaration name: (identifier) @name) @function
(generator_function_declaration name: (identifier) @name) @function
; methods: the member-function shape (class bodies are show-through @class interiors, so the
; method surfaces as its own element; object-literal methods are the same node - same capture)
(method_definition name: (property_identifier) @name) @method

; Callable initializers keep the function capture (old refineCallableInitializers); any other
; lexical/variable declaration is a binding. Earlier patterns win (see header).
(lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function))) @function ; @priority
(lexical_declaration (variable_declarator name: (identifier) @name value: (function_expression))) @function ; @priority
(variable_declaration (variable_declarator name: (identifier) @name value: (arrow_function))) @function ; @priority
(variable_declaration (variable_declarator name: (identifier) @name value: (function_expression))) @function ; @priority
(lexical_declaration (variable_declarator name: (identifier) @name)) @binding ; @priority
(variable_declaration (variable_declarator name: (identifier) @name)) @binding ; @priority

; --- declarations: types ---------------------------------------------------------------------
; @class is the named-class capture: class-like units judged as classes. Interfaces, aliases and
; enums stay @type - every non-class, non-method type shape does.
(class_declaration name: (type_identifier) @name) @class
(abstract_class_declaration name: (type_identifier) @name) @class
(interface_declaration name: (type_identifier) @name) @type
(type_alias_declaration name: (type_identifier) @name) @type
(enum_declaration name: (identifier) @name) @type

; --- imports ----------------------------------------------------------------------------------
; import.merge contiguous: adjacent imports merge per CONTIGUOUS RUN - the engine default
; since the scattered-merge fix; declared here because the per-file merge measured
; diverging (merged span slices included non-import source between scattered imports)
((import_statement) @import (#set! "import.merge" "contiguous"))
((import_require_clause) @import (#set! "import.merge" "contiguous"))
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
(export_statement declaration: (class_declaration name: (type_identifier) @name)) @class ; @priority
(export_statement declaration: (abstract_class_declaration name: (type_identifier) @name)) @class ; @priority
(export_statement declaration: (interface_declaration name: (type_identifier) @name)) @type ; @priority
(export_statement declaration: (type_alias_declaration name: (type_identifier) @name)) @type ; @priority
(export_statement declaration: (enum_declaration name: (identifier) @name)) @type ; @priority
(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function)))) @function ; @priority
(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name value: (function_expression)))) @function ; @priority
(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @name value: (arrow_function)))) @function ; @priority
(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @name value: (function_expression)))) @function ; @priority
(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name))) @binding ; @priority
(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @name))) @binding ; @priority
