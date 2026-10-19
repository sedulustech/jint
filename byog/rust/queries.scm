; rust: extraction patterns over tree-sitter-rust 0.24.2.
;
; THE MEASUREMENT TARGET: functions with their comments. Rust documents through THREE distinct
; comment forms, and the grammar models each: `//` plain (line_comment), `///` outer doc
; (line_comment with outer_doc_comment_marker + doc_comment) and `//!` inner doc (inner marker).
; ALL of them map to plain @comment here - @docstring measured as a text trap for leading
; conventions (see the trial note at the comment patterns below).
;
; DECISIONS (recorded):
; - function_item in an impl or trait body -> @method (structural-context capture, the python
;   precedent: context decides, the node type is shared with free functions).
; - trait-body function_signature_item -> @method, argued: a trait method declaration IS a
;   member function; its contract is the signature and its `///` documents exactly that member.
;   The pair frame (attached run + docstring + code) is honest for a bodiless declaration.
; - impl_item NOT captured: an impl block is a method container, not a type definition - it
;   names no type (no name field) and one type's surface spreads across many impls. Methods
;   surface directly (the go precedent: methods live outside their type's element).
; - mod_item NOT captured: a module is a namespace, not a type; the file is the module.
;
; WAITING (recorded, not stretched):
; - const_item/static_item: honest @binding candidates, not needed for this measurement.
; - let_declaration, closures, macro_definition, attributes: no honest home; invisible today.
; - extern-block function_signature_item: a foreign function declaration, not our function.

; --- declarations -----------------------------------------------------------------------------
(impl_item body: (declaration_list (function_item name: (identifier) @name) @method)) ; @priority
(trait_item body: (declaration_list (function_item name: (identifier) @name) @method)) ; @priority
(trait_item body: (declaration_list (function_signature_item name: (identifier) @name) @method)) ; @priority
(function_item name: (identifier) @name) @function ; @priority

; --- types --------------------------------------------------------------------------------------
(struct_item name: (type_identifier) @name) @type
(enum_item name: (type_identifier) @name) @type
(union_item name: (type_identifier) @name) @type
(trait_item name: (type_identifier) @name) @type ; @priority

; --- imports ------------------------------------------------------------------------------------
(use_declaration) @import

; --- comments and docstrings ---------------------------------------------------------------------
; @priority: the SAME comment node is claimed by exactly one pattern - outer doc, inner doc, or
; plain; pattern order is priority and every pattern in the conflict group states it.
; TRIAL EXPERIMENT 2: @docstring measured as a TEXT TRAP for leading-comment conventions. With
; @docstring + owner next, the doc comment COUNTS for the next definition (comments-target
; membership fires) but its TEXT never enters the measured frame: elementContent is
; attachedComment + content, and only capture=comment enters the attached run - the docstring
; text is in neither, and an owned docstring element never speaks separately. Python's docstring
; rides because it sits INSIDE the body (content); a rust `///` sits before the fn. So the
; honest rust mapping is: doc comments as PLAIN @comment - the attached run carries them into
; the frame (measured: expand_tabs' leading run rides). @docstring stays DECLARED-BUT-OFF for
; this grammar until the frame carries docstring texts (recorded in the trial report).
(line_comment outer: (outer_doc_comment_marker) doc: (doc_comment)) @comment ; @priority
(block_comment outer: (outer_doc_comment_marker) doc: (doc_comment)) @comment ; @priority
(line_comment) @comment ; @priority
(block_comment) @comment ; @priority
