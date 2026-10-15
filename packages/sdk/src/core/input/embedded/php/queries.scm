; php: extraction patterns over tree-sitter-php 0.25.1 (full grammar - HTML interleaving
; parses; php_tag / text_interpolation are template scaffolding and transit).
;
; php's name node is ALWAYS "name" (or under variable_name) - the trial's names blocker dies
; here: @name binds the name node directly, so every definition renders named.
;
; WAITING (recorded, not stretched; the trial's stretches retired):
; - anonymous_function / arrow_function (closures): the trial stretched them to function; a
;   closure is a unit of behavior but nameless - needs the vocabulary to decide (the callable-
;   initializer refinement's php form: $f = fn() => ... wants to keep the binding noun).
; - include_expression / require_expression: runtime control flow, not an import - transit
;   (the trial's own verdict), WAITING for a vocabulary decision.
; - property_declaration (member data): the field capture, same as c/cpp - WAITING.
; - const_declaration / class constants: honest binding (a name bound to a value) - captured.
; - per-alias import decomposition (use A\{B, C}): one declaration, many aliases - the merge
;   keeps it one import element; splitting is a WAITING.

; --- functions ---------------------------------------------------------------------------------
(function_definition name: (name) @name) @function
(method_declaration name: (name) @name) @function

; --- types --------------------------------------------------------------------------------------
(class_declaration name: (name) @name) @type
(interface_declaration name: (name) @name) @type
(trait_declaration name: (name) @name) @type
(enum_declaration name: (name) @name) @type

; --- state ---------------------------------------------------------------------------------------
(assignment_expression left: (variable_name (name) @name)) @binding ; @priority
(const_declaration (const_element (name) @name)) @binding

; --- imports --------------------------------------------------------------------------------------
(namespace_use_declaration) @import

; --- comments --------------------------------------------------------------------------------------
(comment) @comment
