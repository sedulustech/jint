; yaml: extraction patterns over the tree-sitter-yaml grammar (0.7.2).
;
; YAML is configuration data: no node is a function, type or import. The kinds of capture are the
; comment, the pair (one key with its value) and the sequence_item (one entry of a list written with
; dashes; the parser gives an entry between brackets no node). A pair and an item are data, so a
; comment beside one documents the file.
;
; WAITING (recorded, not stretched):
; - document: the unit of a file that holds several.

; The file header: the comment run that opens the file documents the file, not the definition below.
((stream . (comment) @comment) (#set! "docstring.owner" "module")) ; @priority
((comment) @comment (#set! "capture.comment.merge" "contiguous")) ; @priority

(block_mapping_pair key: (_) @key value: (_)? @value) @pair
(#set! "capture.pair.definition" "true")
(#set! "capture.pair.selfNesting" "true")
(#set! "capture.pair.ownsComments" "false")
(#set! "capture.pair.keyOmit" "^[\"']|[\"']$")
(#set! "capture.pair.valueOmit" "^[\"']|[\"']$")

(flow_pair key: (_) @key value: (_)? @value) @pair

((block_sequence_item) @sequence_item (#set! "capture.sequence_item.definition" "true"))
(#set! "capture.sequence_item.selfNesting" "true")
(#set! "capture.sequence_item.ownsComments" "false")
