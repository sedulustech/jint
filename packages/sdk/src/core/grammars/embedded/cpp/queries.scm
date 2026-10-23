; cpp: extraction patterns over tree-sitter-cpp 0.23.4 (the c patterns plus classes,
; templates, methods; c's WAITING ledger carries over - see embedded/c/queries.scm).
;
; ABSORB: a template_declaration is captured through its payload (a template class IS the type;
; a template function IS the function) - the policy table's type absorbTail (2) swallows the
; trailing ';' of "template<...> class X {};".
;
; WAITING (recorded, not stretched; in addition to c's ledger):
; - field_declaration (class members): neither state nor type; the future `field` capture.
;   Members stay inside their class's element today - the trial's field stretch is retired.
; - using_declaration / using_directive / alias_declaration: an alias is not a binding in any
;   honest reading (it is a type alias); waits for the vocabulary.
; - namespace: a container, not an element - transit (its functions surface on their own).
; - macros: invisible to the grammar (preprocessor) - a grammar fact, not a mapping gap.

; --- functions: methods, definitions, prototypes (prototypes FIRST - the c discriminator) ------
; @method: the member-function shapes. In-class prototypes ride field_identifier/field_declaration
; (the priority split keeps member DATA fields WAITING); out-of-line definitions are the
; field_identifier-annotated function_definitions. Free functions keep @function.
(declaration (function_declarator declarator: (field_identifier) @name)) @method ; @priority
(declaration (function_declarator declarator: (pointer_declarator declarator: (field_identifier) @name))) @method ; @priority
(declaration (function_declarator declarator: (identifier) @name)) @function ; @priority
(declaration (function_declarator declarator: (pointer_declarator declarator: (identifier) @name))) @function ; @priority
(declaration (function_declarator)) @function ; @priority
(function_definition declarator: (function_declarator declarator: (field_identifier) @name)) @method ; @priority
; out-of-line method definitions: the qualified declarator (K::f) is the member signal, as the
; field_identifier is for the in-class shapes - same capture, the qualifier is in the render name
(function_definition
  declarator: (function_declarator declarator: (qualified_identifier) @name)) @method ; @priority
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @function ; @priority
(function_definition declarator: (function_declarator declarator: (pointer_declarator declarator: (identifier) @name))) @function ; @priority
(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @function ; @priority
(function_definition declarator: (function_declarator)) @function ; @priority
(function_definition) @function ; @priority

; --- types --------------------------------------------------------------------------------------
; @class: the class capture (templates absorbed through their payload capture the same capture).
; structs, unions, enums and typedefs stay @type - every non-class type shape does.
(class_specifier name: (type_identifier) @name body: (field_declaration_list)) @class
(class_specifier body: (field_declaration_list)) @class
(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @type
(struct_specifier body: (field_declaration_list)) @type
(union_specifier name: (type_identifier) @name body: (field_declaration_list)) @type
(enum_specifier name: (type_identifier) @name (enumerator_list)) @type
(type_definition declarator: (type_identifier) @name) @type
(type_definition declarator: (pointer_declarator declarator: (type_identifier) @name)) @type
(type_definition) @type
(template_declaration (class_specifier)) @class ; @priority
(template_declaration (struct_specifier)) @type ; @priority
(template_declaration (function_definition declarator: (function_declarator declarator: (identifier) @name))) @function ; @priority
(template_declaration (function_definition)) @function ; @priority

; method prototypes live on field_declaration nodes inside class bodies - the priority split is
; what the trial wanted: a member FUNCTION surfaces (as @method), member DATA fields stay
; WAITING (field).
(field_declaration (function_declarator declarator: (field_identifier) @name)) @method ; @priority
(field_declaration (function_declarator declarator: (pointer_declarator declarator: (field_identifier) @name))) @method ; @priority
(field_declaration (function_declarator)) @method ; @priority

; --- state ---------------------------------------------------------------------------------------
(declaration (init_declarator declarator: (identifier) @name)) @binding ; @priority
(declaration declarator: (identifier) @name) @binding ; @priority

; --- imports --------------------------------------------------------------------------------------
; capture.import.merge contiguous: adjacent imports merge per CONTIGUOUS RUN - the engine default
; since the scattered-merge fix; declared here because the per-file merge measured
; diverging (merged span slices included non-import source between scattered imports)
((preproc_include) @import (#set! "capture.import.merge" "contiguous"))

; --- comments --------------------------------------------------------------------------------------
(comment) @comment
