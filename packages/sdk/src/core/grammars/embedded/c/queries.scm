; c: extraction patterns over tree-sitter-c 0.24.2.
;
; Pattern priority splits the trial's one STRETCH: a declaration whose declarator is a
; function_declarator is a PROTOTYPE (a function unit, honest under @function); any other
; declaration is state (@binding). Earlier patterns win - the order below is load-bearing.
;
; WAITING (recorded, not stretched):
; - field (struct/union fields): a field_declaration is not state and not a type; the vocabulary
;   ledger's future `field` capture. Fields live inside their struct's element today.
; - macros are invisible to the grammar (preprocessor) - a grammar fact, not a mapping gap.
; - K&R-style definitions and function-pointer declarations: pattern priority keeps them honest
;   (a function-pointer variable is a binding with a pointer_declarator); no special casing.

; --- functions: definitions and prototypes (prototypes FIRST - priority is the discriminator).
; Names descend through pointer declarators (struct Ring *f(void) - the trial's declarator
; depth). The nameless fallbacks ride LAST so priority keeps the named matches.
;
; @priority declaration-prototype over declaration-state: the function_declarator root split is
; the trial's wanted discriminator - a declaration is a function unit when its declarator is a
; function_declarator, state otherwise.
(declaration (function_declarator declarator: (identifier) @name)) @function ; @priority
(declaration (function_declarator declarator: (pointer_declarator declarator: (identifier) @name))) @function ; @priority
(declaration (pointer_declarator (function_declarator declarator: (identifier) @name))) @function ; @priority
(declaration (function_declarator)) @function ; @priority
(declaration (pointer_declarator (function_declarator))) @function ; @priority
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @function
(function_definition declarator: (function_declarator declarator: (pointer_declarator declarator: (identifier) @name))) @function
(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @function
(function_definition declarator: (function_declarator)) @function
(function_definition declarator: (pointer_declarator declarator: (function_declarator))) @function
(function_definition) @function

; --- types -------------------------------------------------------------------------------------
(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @type
(struct_specifier body: (field_declaration_list)) @type
(union_specifier name: (type_identifier) @name body: (field_declaration_list)) @type
(union_specifier body: (field_declaration_list)) @type
(enum_specifier name: (type_identifier) @name (enumerator_list)) @type
(enum_specifier (enumerator_list)) @type
(type_definition declarator: (type_identifier) @name) @type
(type_definition declarator: (pointer_declarator declarator: (type_identifier) @name)) @type
(type_definition) @type

; --- state (LAST: a declaration is state only when no function pattern took it) ------------------
(declaration (init_declarator declarator: (identifier) @name)) @binding ; @priority
(declaration declarator: (identifier) @name) @binding ; @priority

; --- imports ------------------------------------------------------------------------------------
; capture.import.merge contiguous: adjacent imports merge per CONTIGUOUS RUN - the engine default
; since the scattered-merge fix; declared here because the per-file merge measured
; diverging (merged span slices included non-import source between scattered imports)
((preproc_include) @import (#set! "capture.import.merge" "contiguous"))

; --- comments ------------------------------------------------------------------------------------
(comment) @comment
