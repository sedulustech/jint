; php: extraction patterns over tree-sitter-php 0.25.1 (full grammar - HTML interleaving
; parses; php_tag / text_interpolation are template scaffolding and transit).
;
; php's name node is ALWAYS "name" (or under variable_name) - the trial's names blocker dies
; here: @name binds the name node directly, so every definition renders named.
;
; WAITING (recorded, not stretched; the trial's stretches retired):
; - include_expression / require_expression: runtime control flow, not an import - transit
;   (the trial's own verdict), WAITING for a vocabulary decision.
; - property_declaration (member data): the field capture, same as c/cpp - WAITING.
; - const_declaration / class constants: honest binding (a name bound to a value) - captured.
; - per-alias import decomposition (use A\{B, C}): one declaration, many aliases - the merge
;   keeps it one import element; splitting is a WAITING.

; --- functions ---------------------------------------------------------------------------------
(function_definition name: (name) @name) @function
(method_declaration name: (name) @name) @method

; Closures are functions (nameless functions are still functions - precedent: ts arrows, verilog
; always, test composites). ASSIGNED closures keep ONE element with the function capture: the
; wrapper assignment is captured first (pattern order is priority on the outer node - the ts
; callable-initializer precedent); the bare patterns follow for unassigned closures (arguments,
; returns). A closure nested in another function is a SAME-capture child: it surfaces as its own
; element unless absorb-shaped. The opacity policy hides only DIFFERENT-capture interiors (a
; local binding in a body) - no special case.
(assignment_expression
  left: (variable_name (name) @name)
  right: (arrow_function)) @function ; @priority
(assignment_expression
  left: (variable_name (name) @name)
  right: (anonymous_function)) @function ; @priority
(anonymous_function) @function
(arrow_function) @function

; --- types --------------------------------------------------------------------------------------
; @class is the named-class capture; interfaces, traits and enums stay @type. anonymous_class is
; deliberately NOT judged (an expression, not a unit) - the trial's verdict stands.
(class_declaration name: (name) @name) @class
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
