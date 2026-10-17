; markdown: extraction patterns over tree-sitter-markdown 0.5.3 (block grammar; `inline`
; parses as empty external stubs and is transit anyway).
;
; TWO honest captures exist: the section and the paragraph. A heading plus everything under it is
; markdown's container-with-body; it captures @section - markdown's OWN element capture, not a
; shared noun (the @type stretch was reversed, owner decision: a code noun lying about prose is
; worse than a grammar-autonomous capture). Its name is its heading text (atx_heading > inline) -
; a real name, not an identifier hunt. Rules address sections through the qualified capture
; address (target "markdown:section"), never a shared target noun.
;
; SHAPE DIRECTIVE (the F experiment's result): the section's structure fact - sections nest - is
; expressed IN the .scm as a #set! directive (the meaning and the shape live in one artifact; the
; manifest that carried policy is gone). The runtime reads #set! "selfNesting" syntactically from
; this file; the general tail-absorb rule alone would swallow a boundary-coincident final sibling
; section (experiment F: 13 sections with the flag, 12 without - the last sibling shares the
; root's end offset).
;
; PROSE: the paragraph (flat - paragraphs never nest; the pattern has no #set! directive and the
; policy table's shape keeps them flat) is the second md-only capture, addressed as
; markdown:paragraph. The section CARRIER requires an atx_heading: tree-sitter-markdown wraps
; content BEFORE the first heading in a headingless section - matching it would surface preamble
; (logo HTML blocks) as nameless elements; headingless sections match nothing (honest absence).
;
; STILL WAITING on vocabulary growth (the design's ledger; retired stretches from the trial):
; - code-block (fenced_code_block, indented_code_block): the trial's worst stretch (function);
;   an embedded machine-read unit deserves its own capture.
; - link_reference_definition: the trial stretched it to import; it is not a code import and
;   would vanish into the merge-run anyway.
; - list, list_item, pipe_table*, thematic_break, atx_heading: transit under every mapping so
;   far - none is a judged unit under any noun, and a table row judged alone is noise.

(section (atx_heading (inline) @name)) @section

((section . (atx_heading) .) @section
  (#set! "selfNesting"))

(paragraph) @paragraph
