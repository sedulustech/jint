; toml: extraction patterns over the tree-sitter-toml grammar (0.7.0).
;
; TOML is configuration data: no node is a function, type or import, so the only honest capture is
; the comment. A file still routes here, so a `files` rule reads and judges it.
;
; WAITING (recorded, not stretched):
; - table ([section]) and pair (key = value): the units of a TOML file; they need their own captures.

; The file header: the comment run that opens the file documents the file, not the definition below.
((document . (comment) @comment) (#set! "docstring.owner" "module")) ; @priority
((comment) @comment (#set! "capture.comment.merge" "contiguous")) ; @priority
