; yaml: extraction patterns over the tree-sitter-yaml grammar (0.7.2).
;
; YAML is configuration data: no node is a function, type or import, so the only honest capture is
; the comment. A file still routes here, so a `files` rule reads and judges it.
;
; WAITING (recorded, not stretched):
; - block mapping pair (key: value) and document: the units of a YAML file; they need their own
;   captures.

; The file header: the comment run that opens the file documents the file, not the definition below.
((stream . (comment) @comment) (#set! "docstring.owner" "module")) ; @priority
((comment) @comment (#set! "capture.comment.merge" "contiguous")) ; @priority
