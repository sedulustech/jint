; bash: extraction patterns over the tree-sitter-bash grammar (0.25.1).
;
; A shell script is mostly top-level code: a few functions, a handful of settings, and a main
; flow that runs at file scope. The shared captures cover what has a name; the statement group
; (this grammar's own capture) covers the flow, so a rule can judge it.
;
; WAITING (recorded, not stretched):
; - the usage text of a heredoc is a string, not a docstring: shell has no docstring convention,
;   and a leading comment block already attaches to the next definition.
; - a function's name is a `word`, never a quoted or expanded one; `function` keyword and `name()`
;   forms share one node type, so both are captured the same way.

; --- declarations ----------------------------------------------------------------------------
(function_definition name: (word) @name) @function

; top-level variables are the script's settings: `VAR=value`, and the declaration forms
; (`export`, `readonly`, `declare`, `local`) when they bind a name. The function bodies' own
; assignments are implementation: the function is opaque (the shared default), so they drop.
(program (variable_assignment name: (variable_name) @name) @binding) ; @priority
(program (declaration_command (variable_assignment name: (variable_name) @name)) @binding) ; @priority

; --- imports ----------------------------------------------------------------------------------
; `source file` and `. file` pull another script in exactly as an import does.
((command name: (command_name (word) @name) (#any-of? @name "source" ".")) @import
  (#set! "capture.import.merge" "contiguous"))

; --- comments ---------------------------------------------------------------------------------
; the shebang is a comment node too; it stays one element.
(comment) @comment

; --- top-level statements: the statement group -----------------------------------------------
; STATEMENT GROUP (this grammar's own capture): commands and control flow at file scope that no
; definition owns - the dispatch, the main call, a script's setup - one element per run of
; adjacent statements; only another element ends the run (merge "adjacent": blank lines and
; comments ride inside). Opaque: a loop's variables are its implementation.
; Source lines are imports and bare assignments are bindings, so the group takes neither: a
; `source`/`.` command keeps the @import above (its pattern comes first).
(program
  [(command) (pipeline) (list) (redirected_statement) (negated_command) (subshell)
   (compound_statement) (if_statement) (for_statement) (c_style_for_statement)
   (while_statement) (case_statement) (test_command)] @statement_group
  (#set! "capture.statement_group.definition" "true")
  (#set! "capture.statement_group.merge" "adjacent")
  (#set! "capture.statement_group.opaque" "true")) ; @priority
