; python: extraction patterns over the tree-sitter-python grammar (0.25.0).
;
; python has ONE wrapper: decorated_definition. ABSORB - the wrapper is the element, so the
; decorator prefix travels with it (the old wrapperTypes list, as pattern authoring).
;
; DOCSTRINGS are captured as @comment from STRING nodes (string-in-block, the isolation
; requirement). The manifest's docstringNodeTypes fact tells the walker which captured comment
; nodes are docstrings, so it can own them (docstringOf: the enclosing definition, or the
; module) instead of counting them internal.
;
; WAITING (recorded, not stretched): assignments are NOT bindings in v1 (the old table mapped
; none either); a python binding noun needs the same callable-refinement evidence ts got.

; --- declarations ----------------------------------------------------------------------------
(function_definition name: (identifier) @name) @function
(class_definition name: (identifier) @name) @type

; ABSORB: decorated definitions (decorator prefixes travel with the element)
(decorated_definition (function_definition name: (identifier) @name)) @function
(decorated_definition (class_definition name: (identifier) @name)) @type

; --- imports ----------------------------------------------------------------------------------
(import_statement) @import
(import_from_statement) @import
(future_import_statement) @import

; --- comments and docstrings -------------------------------------------------------------------
(comment) @comment

; The docstring of a definition: the FIRST statement of its body wrapping a string.
(function_definition body: (block . (expression_statement (string) @comment)))
(class_definition body: (block . (expression_statement (string) @comment)))

; The module docstring: the file's first statement wrapping a string.
(module . (expression_statement (string) @comment))
