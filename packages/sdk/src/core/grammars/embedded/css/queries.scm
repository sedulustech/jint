; css: extraction patterns over the tree-sitter-css grammar (0.25.0).
;
; The frozen five have ONE honest answer in a declarative language: comments. The code captures
; (function/type/binding) have no honest css home - the trials' stretch mappings (rule_set ->
; type, declaration -> binding) are retired as decided policy: prefer absence + recorded wait
; over a poisoned frame.
;
; WAITING for vocabulary growth (recorded, not stretched - see the design's vocabulary ledger):
; - selector-rule (rule_set): the unit of a stylesheet; needs its own capture.
; - declaration-pair (declaration): property: value; needs its own capture.
; - @-statements (media_statement, keyframes_statement, import_statement, at_rule): containers
;   and directives; the import capture is tempting for @import but css imports are not code
;   imports (no merge-run semantics) - decide with the vocabulary, not by stretch.
; - names: a selector is NOT a declared name (compound selectors lose on @name); css name leaves
;   (property_name, class_name, tag_name, keyframes_name) are not identifiers.
;
; Legal result: a comments-only inventory. A stylesheet with no comments yields zero elements -
; legal per this grammar (css field trial), so the zero-elements safety net cannot be relied on
; for css.

(comment) @comment
