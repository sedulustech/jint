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
; - call_expression composites (describe/it blocks): the old walker stretched every top-level
;   call to the function noun and descended into its arguments. Not captured; needs contextual
;   refinement (a call is a definition only when its callback carries declarations).
; - header-bounded class spans: elements carry their full node text now; the size backstop skips
;   what overflows.

; --- declarations: functions -----------------------------------------------------------------
(function_declaration name: (identifier) @name) @function
(generator_function_declaration name: (identifier) @name) @function
(method_definition name: (property_identifier) @name) @function

; Callable initializers keep the function noun (old refineCallableInitializers); any other
; lexical/variable declaration is a binding. Earlier patterns win (see header).
(lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function))) @function
(lexical_declaration (variable_declarator name: (identifier) @name value: (function_expression))) @function
(variable_declaration (variable_declarator name: (identifier) @name value: (arrow_function))) @function
(variable_declaration (variable_declarator name: (identifier) @name value: (function_expression))) @function
(lexical_declaration (variable_declarator name: (identifier) @name)) @binding
(variable_declaration (variable_declarator name: (identifier) @name)) @binding

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

; --- comments ---------------------------------------------------------------------------------
(comment) @comment

; --- export wrappers: ABSORB ------------------------------------------------------------------
; The wrapper is the element: the span carries the "export" prefix, the inner declaration's
; bare pattern match is suppressed by same-capture nesting (see query.ts). Absorb = capture
; the wrapper; no walker unwrap step exists.
(export_statement declaration: (function_declaration name: (identifier) @name)) @function
(export_statement declaration: (generator_function_declaration name: (identifier) @name)) @function
(export_statement declaration: (class_declaration name: (type_identifier) @name)) @type
(export_statement declaration: (abstract_class_declaration name: (type_identifier) @name)) @type
(export_statement declaration: (interface_declaration name: (type_identifier) @name)) @type
(export_statement declaration: (type_alias_declaration name: (type_identifier) @name)) @type
(export_statement declaration: (enum_declaration name: (identifier) @name)) @type
(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function)))) @function
(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name value: (function_expression)))) @function
(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @name value: (arrow_function)))) @function
(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @name value: (function_expression)))) @function
(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name))) @binding
(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @name))) @binding
