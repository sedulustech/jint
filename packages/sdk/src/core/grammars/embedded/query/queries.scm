; query: extraction patterns over the tree-sitter-query grammar (0.8.0), the language of the
; queries.scm files themselves.
;
; The kinds of capture are the comment, the definition (a pattern at the top of the file), the node
; (any node a pattern matches), the capture (an @name on a node) and the field (a `field: ...`
; inside a node). A node holds its captures and its child nodes, so a rule reads a node's type
; with `name` and each capture's name from the captures inside it, one level at a time.
;
; A node's name is its type: the identifier of a named node, the text of a quoted node, `_` for a
; wildcard. A list `[ ... ]` or a grouping `( ... )` of nodes has no type, so it has no name. A
; capture's name is the text after its @. A `#set!` line after a definition is a predicate of the
; file, not a definition.
;
; WAITING (recorded, not stretched):
; - predicate: a `#set!` or `#eq?` line has no capture yet, because no rule reads one.
; - negated_field, quantifier: a node's own marks, read from its text.
; - a supertype node such as (expression/binary_expression) has the supertype as its name.

; The file header: the comment run that opens the file documents the file, not the definition below.
((program . (comment) @comment) (#set! "docstring.owner" "module")) ; @priority
((comment) @comment (#set! "capture.comment.merge" "contiguous")) ; @priority

(program [(named_node) (anonymous_node) (grouping) (list) (missing_node)] @definition)
(#set! "capture.definition.definition" "true")
(#set! "capture.definition.sharesSpan" "true")

(named_node . "(" . (identifier) @name) @node ; @priority
(named_node . "(" . "_" @name) @node ; @priority
(anonymous_node (string (string_content)? @name)) @node ; @priority
(missing_node (identifier)? @name) @node ; @priority
(grouping) @node ; @priority
(list) @node ; @priority
(#set! "capture.node.definition" "true")
(#set! "capture.node.selfNesting" "true")
(#set! "capture.node.ownsComments" "false")

; A capture also names a node in a predicate's parameters, and that one marks nothing: only a capture
; inside a node is an element.
(named_node (capture (identifier) @name) @capture) ; @priority
(anonymous_node (capture (identifier) @name) @capture) ; @priority
(missing_node (capture (identifier) @name) @capture) ; @priority
(grouping (capture (identifier) @name) @capture) ; @priority
(list (capture (identifier) @name) @capture) ; @priority
(#set! "capture.capture.definition" "true")
(#set! "capture.capture.ownsComments" "false")

(field_definition . (identifier) @name) @field
(#set! "capture.field.definition" "true")
(#set! "capture.field.ownsComments" "false")
