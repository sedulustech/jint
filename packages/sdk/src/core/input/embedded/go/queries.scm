; go: extraction patterns over the tree-sitter-go grammar (0.25.0).
;
; go is flat: every declaration sits at the top level, methods live OUTSIDE their type, and there
; are no wrappers. The old table carried no wrapperTypes and no composites - the query shape is
; the flat shape.
;
; WAITING (recorded, not stretched):
; - short_var_declaration (x := 1) inside functions: opaque interiors drop them (see query.ts);
;   package-level := does not exist, so nothing honest is lost.
; - go's doc convention is the attached leading comment run (the generic attachment covers it);
;   the package-per-dir convention is a DIRECTORY fact, not a file-level capture.

; --- declarations ----------------------------------------------------------------------------
(function_declaration name: (identifier) @name) @function
(method_declaration name: (field_identifier) @name) @function

; type_declaration wraps one or more type_spec; its full text is the element (a multi-spec block
; is one element - the old table's shape). The anchor pattern (first AND last child) names a
; single-spec block; the bare pattern is the nameless fallback and MUST come after it (pattern
; order is priority).
(type_declaration . (type_spec name: (type_identifier) @name) .) @type
(type_declaration) @type

; package-level const/var blocks are go's bindings (a consts-only package file must still yield
; elements). Same anchor trick: only a single-spec block takes a name - a multi-spec block has no
; single name, and a missing name is honest where a wrong one is not.
(const_declaration . (const_spec name: (identifier) @name) .) @binding
(const_declaration) @binding
(var_declaration . (var_spec name: (identifier) @name) .) @binding
(var_declaration) @binding

; --- imports ----------------------------------------------------------------------------------
(import_declaration) @import

; --- comments ---------------------------------------------------------------------------------
(comment) @comment
