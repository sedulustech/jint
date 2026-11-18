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
; members declared in a class body are methods whatever their declarator: a constructor (identifier),
; a destructor (destructor_name), an operator (operator_name) or a member template. The structural
; context - a direct child of the class body - is the signal, as for python methods; these come
; before the free-function patterns because pattern order is priority.
(field_declaration_list (declaration declarator: (function_declarator declarator: [(identifier) (destructor_name) (operator_name)] @name)) @method) ; @priority
(field_declaration_list (declaration (function_declarator)) @method) ; @priority
(field_declaration_list (function_definition declarator: (function_declarator declarator: [(field_identifier) (identifier) (destructor_name) (operator_name)] @name) body: (_)? @body) @method) ; @priority
(field_declaration_list (function_definition body: (_)? @body) @method) ; @priority
(field_declaration_list (template_declaration (function_definition declarator: (function_declarator declarator: [(field_identifier) (identifier) (destructor_name) (operator_name)] @name) body: (_)? @body)) @method) ; @priority
(field_declaration_list (template_declaration (function_definition body: (_)? @body)) @method) ; @priority
; a template prototype IS the function and absorbs its template header, as the definition does
(template_declaration (declaration (function_declarator declarator: (identifier) @name))) @function ; @priority
; a function-pointer VARIABLE (`int (*fp)(int);`) is state: its declarator is a function_declarator over
; a parenthesized pointer, so it must outrank the nameless prototype fallback below.
(declaration (function_declarator declarator: (parenthesized_declarator (pointer_declarator declarator: (identifier) @name)))) @binding ; @priority
((declaration (function_declarator declarator: (identifier) @name)) @function (#set! "capture.function.naming" "first")) ; @priority
(declaration (function_declarator declarator: (pointer_declarator declarator: (identifier) @name))) @function ; @priority
(declaration (function_declarator)) @function ; @priority
(function_definition declarator: (function_declarator declarator: (field_identifier) @name) body: (_)? @body) @method ; @priority
; out-of-line method definitions: the qualified declarator (K::f) is the member signal, as the
; field_identifier is for the in-class shapes - same capture, the qualifier is in the render name
(function_definition
  declarator: (function_declarator declarator: (qualified_identifier) @name)
  body: (_)? @body) @method ; @priority
(function_definition declarator: (function_declarator declarator: (identifier) @name) body: (_)? @body) @function ; @priority
(function_definition declarator: (function_declarator declarator: (pointer_declarator declarator: (identifier) @name)) body: (_)? @body) @function ; @priority
(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name)) body: (_)? @body) @function ; @priority
(function_definition declarator: (function_declarator) body: (_)? @body) @function ; @priority
(function_definition body: (_)? @body) @function ; @priority

; --- types --------------------------------------------------------------------------------------
; @class: the class capture (templates absorbed through their payload capture the same capture).
; structs, unions, enums and typedefs stay @type - every non-class type shape does.
; a class needs a body: `class Fwd;` is a forward declaration, no unit (struct, union and enum agree)
(class_specifier name: (type_identifier) @name body: (field_declaration_list) @body) @class
(class_specifier body: (field_declaration_list) @body) @class
(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @type
(struct_specifier body: (field_declaration_list)) @type
(union_specifier name: (type_identifier) @name body: (field_declaration_list)) @type
(enum_specifier name: (type_identifier) @name (enumerator_list)) @type
((type_definition declarator: (type_identifier) @name) @type (#set! "capture.type.naming" "first"))
(type_definition declarator: (pointer_declarator declarator: (type_identifier) @name)) @type
(type_definition) @type
(template_declaration (class_specifier name: (type_identifier) @name body: (field_declaration_list) @body)) @class ; @priority
(template_declaration (class_specifier body: (field_declaration_list) @body)) @class ; @priority
(template_declaration (struct_specifier name: (type_identifier) @name body: (field_declaration_list))) @type ; @priority
(template_declaration (struct_specifier body: (field_declaration_list))) @type ; @priority
(template_declaration (function_definition declarator: (function_declarator declarator: (identifier) @name) body: (_)? @body)) @function ; @priority
(template_declaration (function_definition)) @function ; @priority

; method prototypes live on field_declaration nodes inside class bodies - the priority split is
; what the trial wanted: a member FUNCTION surfaces (as @method), member DATA fields stay
; WAITING (field).
((field_declaration (function_declarator declarator: (field_identifier) @name)) @method (#set! "capture.method.naming" "first")) ; @priority
(field_declaration (function_declarator declarator: (pointer_declarator declarator: (field_identifier) @name))) @method ; @priority
(field_declaration (function_declarator)) @method ; @priority

; one element carries one name: a node one pattern matches once per declarator (int i, j;) keeps its first name
; --- state ---------------------------------------------------------------------------------------
; One pattern for every declarator shape, so `naming first` keeps the first name in source whatever
; mix the declaration holds (`int a, b = 1;`): a bare identifier, an initialized one, and either
; behind a pointer or an array declarator.
((declaration
  declarator: [
    (identifier) @name
    (init_declarator declarator: (identifier) @name)
    (pointer_declarator declarator: (identifier) @name)
    (init_declarator declarator: (pointer_declarator declarator: (identifier) @name))
    (array_declarator declarator: (identifier) @name)
    (init_declarator declarator: (array_declarator declarator: (identifier) @name))
  ]) @binding (#set! "capture.binding.naming" "first")) ; @priority

; --- imports --------------------------------------------------------------------------------------
; capture.import.merge contiguous: adjacent imports merge per CONTIGUOUS RUN - the engine default
; since the scattered-merge fix; declared here because the per-file merge measured
; diverging (merged span slices included non-import source between scattered imports)
((preproc_include) @import (#set! "capture.import.merge" "contiguous"))

; --- comments --------------------------------------------------------------------------------------
; The file header: the comment run that opens the file documents the file, not the definition below.
((translation_unit . (comment) @comment) (#set! "docstring.owner" "module")) ; @priority
((comment) @comment (#set! "capture.comment.merge" "contiguous")) ; @priority
