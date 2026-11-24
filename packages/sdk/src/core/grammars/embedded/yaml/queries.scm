; yaml: extraction patterns over the tree-sitter-yaml grammar (0.7.2).
;
; YAML is configuration data: no node is a function, type or import. The kinds of capture are the
; comment and the pair, one key with its value. A pair is data, so a comment beside it documents the
; file and not the pair.
;
; WAITING (recorded, not stretched):
; - document: the unit of a file that holds several.

; The file header: the comment run that opens the file documents the file, not the definition below.
((stream . (comment) @comment) (#set! "docstring.owner" "module")) ; @priority
((comment) @comment (#set! "capture.comment.merge" "contiguous")) ; @priority

(block_mapping_pair key: (_) @name value: (_)? @value) @pair
(#set! "capture.pair.definition" "true")
(#set! "capture.pair.selfNesting" "true")
(#set! "capture.pair.ownsComments" "false")
(#set! "capture.pair.nameOmit" "^[\"']|[\"']$")
(#set! "capture.pair.valueOmit" "^[\"']|[\"']$")

(flow_pair key: (_) @name value: (_)? @value) @pair
