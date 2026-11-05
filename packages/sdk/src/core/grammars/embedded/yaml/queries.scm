; yaml: extraction patterns over the tree-sitter-yaml grammar (0.7.2).
;
; YAML is configuration data: no node is a function, type or import, so the only honest capture is
; the comment. A file still routes here, so a `files` rule reads and judges it.
;
; WAITING (recorded, not stretched):
; - block mapping pair (key: value) and document: the units of a YAML file; they need their own
;   captures.

(comment) @comment
