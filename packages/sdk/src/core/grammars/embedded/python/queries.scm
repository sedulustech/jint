; python: extraction patterns over the tree-sitter-python grammar (0.25.0).
;
; python has ONE wrapper: decorated_definition. ABSORB - the wrapper is the element, so the
; decorator prefix travels with it (the old wrapperTypes list, as pattern authoring).
;
; DOCSTRINGS are captured with the @docstring capture (string-in-block, the isolation
; requirement). @docstring is a comment-kind capture: the walker owns these elements
; (docstringOf: the enclosing definition, or the
; module) instead of counting them internal.
;
; WAITING (recorded, not stretched): assignments are NOT bindings in v1 (the old table mapped
; none either); a python binding capture needs the same callable-refinement evidence ts got.

; --- declarations ----------------------------------------------------------------------------
; methods: the FIRST STRUCTURAL-CONTEXT capture - @method is captured positionally (a
; function_definition sitting in a class body), not nominally (the node type alone is shared with
; free functions). Pattern order makes the context capture win over the bare @function pattern
; for the same node; a function nested INSIDE a method is suppressed by the method's opaque
; interior (same-capture collapse), so only class-body methods surface. Undecorated methods are
; anchored as DIRECT children of the class body; decorated ones are captured through their
; decorated_definition wrapper (earlier than the bare @function wrapper pattern - priority), so
; the method's own decorators travel with it.
(class_definition name: (identifier) @name) @class ; @priority
(class_definition body: (block (function_definition name: (identifier) @name) @method)) ; @priority
(class_definition
  body: (block (decorated_definition (function_definition name: (identifier) @name)) @method)) ; @priority
(function_definition name: (identifier) @name) @function ; @priority

; ABSORB: decorated definitions (decorator prefixes travel with the element)
; @priority: a decorated_definition is a function, a method, OR a class - the earlier context
; pattern takes decorated methods; the remaining two never share a node
(decorated_definition (function_definition name: (identifier) @name)) @function ; @priority
(decorated_definition (class_definition name: (identifier) @name)) @class ; @priority

; --- imports ----------------------------------------------------------------------------------
; capture.import.merge contiguous: adjacent imports merge per CONTIGUOUS RUN - the engine default
; since the scattered-merge fix; declared here because the per-file merge measured
; diverging (merged span slices included non-import source between scattered imports)
((import_statement) @import (#set! "capture.import.merge" "contiguous"))
((import_from_statement) @import (#set! "capture.import.merge" "contiguous"))
((future_import_statement) @import (#set! "capture.import.merge" "contiguous"))

; --- comments and docstrings -------------------------------------------------------------------
(comment) @comment

; The docstring of a definition: the FIRST statement of its body wrapping a string.
; @priority: the docstring capture coexists with the definition capture (different nodes)
(function_definition body: (block . (expression_statement (string) @docstring))) ; @priority
(class_definition body: (block . (expression_statement (string) @docstring))) ; @priority

; The module docstring: the file's first statement wrapping a string.
(module . (expression_statement (string) @docstring)) ; @priority
