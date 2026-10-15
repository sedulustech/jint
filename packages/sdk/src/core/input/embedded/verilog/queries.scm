; verilog: extraction patterns over tree-sitter-verilog 1.0.3 (SystemVerilog).
;
; THE HONEST-STRETCH CALL (steer: judge always_construct fresh): always_construct -> @function
; is KEPT as honest, not a stretch. An always block is a procedural behavioral unit with a body
; and an event control header - the closest thing verilog has to a function-with-body; the code
; nouns describe it without lying. initial/final_construct: same shape, same call.
;
; WAITING (recorded, not stretched; the trial's vocabulary ledger):
; - module_instantiation (u_counter): a hardware unit wired in - no honest home in the five; the
;   ledger's future module/port/instance captures. Transit today: the wiring is invisible.
; - net/reg declarations name no single name when they declare vectors lists; captured whole as
;   bindings (a name binding to a wire). parameter_port_list stays inside its module element.
; - packages/interfaces/programs: same container shape as module - add with the vocabulary.

; --- hardware units -----------------------------------------------------------------------------
(module_declaration (module_header (simple_identifier) @name)) @type
(module_declaration) @type

; --- behavior -------------------------------------------------------------------------------------
(always_construct) @function
(initial_construct) @function
(final_construct) @function
(function_declaration (function_body_declaration (function_identifier) @name)) @function
(task_declaration (task_body_declaration (task_identifier) @name)) @function

; --- state -----------------------------------------------------------------------------------------
(net_declaration) @binding
(data_declaration) @binding
(continuous_assign) @binding

; --- comments ---------------------------------------------------------------------------------------
(comment) @comment
