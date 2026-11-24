; markdown: extraction patterns over tree-sitter-markdown 0.5.4 (block grammar; `inline`
; parses as empty external stubs and is transit anyway).
;
; These kinds of capture exist: the heading levels, the heading line, the code block and its code, the
; frontmatter, the paragraph (loose prose), the list_item (one
; entry's text), the list (the whole list - the headword rule judges the list whole, the
; stateful rule judges each entry; the two granularities are two rules' questions, not one) and
; the table (the whole pipe table: a cell, a row or a column is read against its header and its
; siblings, so only the whole table is a unit a rule can judge). A heading plus everything under it is
; markdown's container-with-body; it captures by heading level, @h1 to @h6 - markdown's OWN element
; captures, not shared captures (the @type stretch was reversed, owner decision: a code capture
; lying about prose is worse than a grammar-autonomous capture). One capture per level lets a rule
; judge one level, such as the entries of a reference page, without the sections that hold them.
; Its name is its heading text (atx_heading > inline) - a real name, not an identifier hunt. Rules
; address a level through the qualified capture address (target "markdown:h2"), never a shared
; target capture.
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
; - setext_heading: the parser makes no section for it, so it has no body to capture.
; - link_reference_definition: the trial stretched it to import; it is not a code import and
;   would vanish into the merge-run anyway.
; - pipe_table_row, pipe_table_cell, thematic_break: transit under every mapping so
;   far - none is a judged unit under any capture, and a row or cell judged alone is noise. The
;   table is judged whole (the @table capture below).

; @priority each heading level over the prose captures it carries: the outer element wins (the
; .scm's own order statement - see the pattern-order validator)
(section . (atx_heading (atx_h1_marker) (inline)? @name)) @h1 ; @priority
(#set! "capture.h1.definition" "true")
(#set! "capture.h1.selfNesting" "true")
(#set! "capture.h1.nameOmit" "(^|\\s+)#+\\s*$")

(section . (atx_heading (atx_h2_marker) (inline)? @name)) @h2 ; @priority
(#set! "capture.h2.definition" "true")
(#set! "capture.h2.selfNesting" "true")
(#set! "capture.h2.nameOmit" "(^|\\s+)#+\\s*$")

(section . (atx_heading (atx_h3_marker) (inline)? @name)) @h3 ; @priority
(#set! "capture.h3.definition" "true")
(#set! "capture.h3.selfNesting" "true")
(#set! "capture.h3.nameOmit" "(^|\\s+)#+\\s*$")

(section . (atx_heading (atx_h4_marker) (inline)? @name)) @h4 ; @priority
(#set! "capture.h4.definition" "true")
(#set! "capture.h4.selfNesting" "true")
(#set! "capture.h4.nameOmit" "(^|\\s+)#+\\s*$")

(section . (atx_heading (atx_h5_marker) (inline)? @name)) @h5 ; @priority
(#set! "capture.h5.definition" "true")
(#set! "capture.h5.selfNesting" "true")
(#set! "capture.h5.nameOmit" "(^|\\s+)#+\\s*$")

(section . (atx_heading (atx_h6_marker) (inline)? @name)) @h6 ; @priority
(#set! "capture.h6.definition" "true")
(#set! "capture.h6.selfNesting" "true")
(#set! "capture.h6.nameOmit" "(^|\\s+)#+\\s*$")

; heading: the heading line alone, marks included. A section that holds only its heading is one
; element, the section: the two nodes have one span.
((atx_heading) @heading (#set! "capture.heading.definition" "true"))

; list_item: the paragraph INSIDE a bullet/numbered entry, marker stripped - one per entry,
; continuations folded in (the nested form: a nested entry's paragraph is a direct child of the
; NESTED list_item, so it belongs to the nested item; the loose prose patterns below never see it)
(list_item (paragraph) @list_item (#set! "capture.list_item.definition" "true"))

; list: the WHOLE list as one element - one per bullet/ordered list, spanning every item. A
; nested list is a list node of its own and nests legitimately (the selfNesting fact below rides
; the grammar-wide flag the sections already declare: sections and lists both nest)
(list) @list (#set! "capture.list.definition" "true") (#set! "capture.list.selfNesting" "true")

; PROSE, loose: paragraphs NOT inside a list entry. Parents are enumerated honestly (the grammar
; allows paragraph under section, list_item, block_quote): the list_item parent is claimed above,
; so loose prose is the section-direct and quoted forms - the loose-in-list stretch is gone.
(section (paragraph) @paragraph (#set! "capture.paragraph.definition" "true") (#set! "capture.paragraph.omit" "continuation")) ; @priority
(block_quote (paragraph) @paragraph)

; code: code_block is a whole fence, code the text inside it. An indented block has no fence, so it
; is code alone; an empty fence has no text, so it is a code_block alone.
((fenced_code_block) @code_block (#set! "capture.code_block.definition" "true") (#set! "capture.code_block.omit" "continuation"))
((code_fence_content) @code (#set! "capture.code.definition" "true") (#set! "capture.code.omit" "continuation")) ; @priority
((indented_code_block) @code)

; continuation: the > or the indent that a quote or a list puts before each line of a block inside
; it. It belongs to the quote or the list, so the block's own text leaves it out.
((block_continuation) @continuation (#set! "capture.continuation.definition" "false"))

; frontmatter: the YAML block fenced by --- on the file's first lines (tree-sitter-markdown's
; minus_metadata). One element per file at most, a leaf the sections never contain: it precedes
; the first heading, so it is the page's own metadata (title, description), judged whole.
((minus_metadata) @frontmatter (#set! "capture.frontmatter.definition" "true"))

; table: the WHOLE pipe table as one element - header row, delimiter row and every body row. One
; per table; a table in a list entry or a quote is the same node and is captured the same way.
((pipe_table) @table (#set! "capture.table.definition" "true"))
