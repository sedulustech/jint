; toml: extraction patterns over the tree-sitter-toml grammar (0.7.0).
;
; TOML is configuration data: no node is a function, type or import, so the only honest capture is
; the comment. A file still routes here, so a `files` rule reads and judges it.
;
; WAITING (recorded, not stretched):
; - table ([section]) and pair (key = value): the units of a TOML file; they need their own captures.

(comment) @comment
