; json: extraction patterns over the tree-sitter-json grammar (0.24.8).
;
; JSON is data, not code: no node is a function, a type, an import or a named binding in the sense
; the captures mean, so the only honest capture is the comment (JSONC and tooling configs carry
; them). A file still routes here, so a `files` rule reads and judges it; that is the point of the
; grammar.
;
; WAITING (recorded, not stretched):
; - pair (key: value): the unit of an object; needs its own capture, like css's declaration.

(comment) @comment
