; markdown: extraction patterns over tree-sitter-markdown 0.5.3 (block grammar; `inline`
; parses as empty external stubs and is transit anyway).
;
; FOUR honest captures exist: the section, the paragraph (loose prose), the list_item (one
; entry's text) and the list (the whole list - the headword rule judges the list whole, the
; stateful rule judges each entry; the two granularities are two rules' questions, not one). A heading plus everything under it is
; markdown's container-with-body; it captures @section - markdown's OWN element capture, not a
; shared capture (the @type stretch was reversed, owner decision: a code capture lying about prose is
; worse than a grammar-autonomous capture). Its name is its heading text (atx_heading > inline) -
; a real name, not an identifier hunt. Rules address sections through the qualified capture
; address (target "markdown:section"), never a shared target capture.
;
; SHAPE DIRECTIVE (the F experiment's result): the section's structure fact - sections nest - is
; expressed IN the .scm as a #set! directive (the meaning and the shape live in one artifact; the
; manifest that carried policy is gone). The runtime reads #set! "selfNesting" syntactically from
; this file; the general tail-absorb rule alone would swallow a boundary-coincident final sibling
; section (experiment F: 13 sections with the flag, 12 without - the last sibling shares the
; root's end offset).
;
; PROSE: the paragraph (flat - paragraphs never nest; the pattern has no #set! directive and the
; policy table's shape keeps them flat) is addressed as markdown:paragraph - LOOSE only: the
; pattern enumerates the parents a loose paragraph has (section-direct, block_quote); the
; list_item parent is the @list_item capture below, so an in-list paragraph is a list entry,
; never loose prose (no double capture). The section CARRIER requires an atx_heading:
; tree-sitter-markdown wraps content BEFORE the first heading in a headingless section - matching
; it would surface preamble (logo HTML blocks) as nameless elements; headingless sections match
; nothing (honest absence).
;
; STILL WAITING on vocabulary growth (the design's ledger; retired stretches from the trial):
; - code-block (fenced_code_block, indented_code_block): the trial's worst stretch (function);
;   an embedded machine-read unit deserves its own capture.
; - link_reference_definition: the trial stretched it to import; it is not a code import and
;   would vanish into the merge-run anyway.
; - pipe_table*, thematic_break, atx_heading: transit under every mapping so far - none is a
;   judged unit under any capture, and a table row judged alone is noise.

; @priority section over the prose captures it carries: the outer element wins (the .scm's
; own order statement - see the pattern-order validator)
(section (atx_heading (inline) @name)) @section (#set! "capture.section.definition" "true") ; @priority

((section . (atx_heading) .) @section ; @priority
  (#set! "selfNesting"))

; list_item: the paragraph INSIDE a bullet/numbered entry, marker stripped - one per entry,
; continuations folded in (the nested form: a nested entry's paragraph is a direct child of the
; NESTED list_item, so it belongs to the nested item; the loose prose patterns below never see it)
(list_item (paragraph) @list_item (#set! "capture.list_item.definition" "true"))

; list: the WHOLE list as one element - one per bullet/ordered list, spanning every item. A
; nested list is a list node of its own and nests legitimately (the selfNesting fact below rides
; the grammar-wide flag the sections already declare: sections and lists both nest)
(list) @list (#set! "capture.list.definition" "true")

; PROSE, loose: paragraphs NOT inside a list entry. Parents are enumerated honestly (the grammar
; allows paragraph under section, list_item, block_quote): the list_item parent is claimed above,
; so loose prose is the section-direct and quoted forms - the loose-in-list stretch is gone.
(section (paragraph) @paragraph (#set! "capture.paragraph.definition" "true")) ; @priority
(block_quote (paragraph) @paragraph)
