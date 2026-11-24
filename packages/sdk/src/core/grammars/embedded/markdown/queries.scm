; markdown: extraction patterns over tree-sitter-markdown 0.5.4 (block grammar; `inline`
; parses as empty external stubs and is transit anyway).
;
; These kinds of capture exist: the section and the heading line, each by its level, the code block and its
; code, the frontmatter, the paragraph, the list_item (one entry, whole), the list (the
; whole list - the headword rule judges the list whole, the stateful rule judges each entry; the two
; granularities are two rules' questions, not one) and the table (the whole pipe table: a cell, a row
; or a column is read against its header and its siblings, so only the whole table is a unit a rule
; can judge). They are markdown's OWN element captures, not shared captures (the @type stretch was
; reversed, owner decision: a code capture lying about prose is worse than a grammar-autonomous
; capture). One capture per level lets a rule judge one level, such as the entries of a
; reference page. The name of both is the heading text
; (atx_heading > inline) - a real name, not an identifier hunt. Rules address them through the
; qualified capture address (target "markdown:h2"), never a shared target capture.
;
; SHAPE DIRECTIVE (the F experiment's result): the section's structure fact - sections nest - is
; expressed IN the .scm as a #set! directive (the meaning and the shape live in one artifact; the
; manifest that carried policy is gone). The runtime reads #set! "selfNesting" syntactically from
; this file; the general tail-absorb rule alone would swallow a boundary-coincident final sibling
; section (experiment F: 13 sections with the flag, 12 without - the last sibling shares the
; root's end offset).
;
; PROSE: the paragraph never nests, so it has no shape directive. The section CARRIER requires an
; atx_heading:
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

; h1.section to h6.section: a heading and everything under it, down to the next heading of its level
; or a higher one. The parser's section node has no level of its own: its heading's marker says it.
; @priority over the captures it carries: the outer element wins (the .scm's own order statement - see
; the pattern-order validator)
(section . (atx_heading (atx_h1_marker) (inline)? @name)) @h1.section ; @priority
(#set! "capture.h1.section.definition" "true")
(#set! "capture.h1.section.selfNesting" "true")
(#set! "capture.h1.section.sharesSpan" "true")
(#set! "capture.h1.section.nameOmit" "(^|\\s+)#+\\s*$")

(section . (atx_heading (atx_h2_marker) (inline)? @name)) @h2.section ; @priority
(#set! "capture.h2.section.definition" "true")
(#set! "capture.h2.section.selfNesting" "true")
(#set! "capture.h2.section.sharesSpan" "true")
(#set! "capture.h2.section.nameOmit" "(^|\\s+)#+\\s*$")

(section . (atx_heading (atx_h3_marker) (inline)? @name)) @h3.section ; @priority
(#set! "capture.h3.section.definition" "true")
(#set! "capture.h3.section.selfNesting" "true")
(#set! "capture.h3.section.sharesSpan" "true")
(#set! "capture.h3.section.nameOmit" "(^|\\s+)#+\\s*$")

(section . (atx_heading (atx_h4_marker) (inline)? @name)) @h4.section ; @priority
(#set! "capture.h4.section.definition" "true")
(#set! "capture.h4.section.selfNesting" "true")
(#set! "capture.h4.section.sharesSpan" "true")
(#set! "capture.h4.section.nameOmit" "(^|\\s+)#+\\s*$")

(section . (atx_heading (atx_h5_marker) (inline)? @name)) @h5.section ; @priority
(#set! "capture.h5.section.definition" "true")
(#set! "capture.h5.section.selfNesting" "true")
(#set! "capture.h5.section.sharesSpan" "true")
(#set! "capture.h5.section.nameOmit" "(^|\\s+)#+\\s*$")

(section . (atx_heading (atx_h6_marker) (inline)? @name)) @h6.section ; @priority
(#set! "capture.h6.section.definition" "true")
(#set! "capture.h6.section.selfNesting" "true")
(#set! "capture.h6.section.sharesSpan" "true")
(#set! "capture.h6.section.nameOmit" "(^|\\s+)#+\\s*$")

; h1 to h6: the heading line alone, marks included. A heading has one marker, so one pattern matches it.
(atx_heading (atx_h1_marker) (inline)? @name) @h1 ; @priority
(#set! "capture.h1.definition" "true")
(#set! "capture.h1.nameOmit" "(^|\\s+)#+\\s*$")

(atx_heading (atx_h2_marker) (inline)? @name) @h2 ; @priority
(#set! "capture.h2.definition" "true")
(#set! "capture.h2.nameOmit" "(^|\\s+)#+\\s*$")

(atx_heading (atx_h3_marker) (inline)? @name) @h3 ; @priority
(#set! "capture.h3.definition" "true")
(#set! "capture.h3.nameOmit" "(^|\\s+)#+\\s*$")

(atx_heading (atx_h4_marker) (inline)? @name) @h4 ; @priority
(#set! "capture.h4.definition" "true")
(#set! "capture.h4.nameOmit" "(^|\\s+)#+\\s*$")

(atx_heading (atx_h5_marker) (inline)? @name) @h5 ; @priority
(#set! "capture.h5.definition" "true")
(#set! "capture.h5.nameOmit" "(^|\\s+)#+\\s*$")

(atx_heading (atx_h6_marker) (inline)? @name) @h6 ; @priority
(#set! "capture.h6.definition" "true")
(#set! "capture.h6.nameOmit" "(^|\\s+)#+\\s*$")

; list_item: one WHOLE entry, its marker and everything nested in it. Its text alone is its paragraph.
((list_item) @list_item (#set! "capture.list_item.definition" "true"))
(#set! "capture.list_item.selfNesting" "true")

; list: the WHOLE list as one element - one per bullet/ordered list, spanning every item. A nested
; list is an element inside its entry. A list of one entry has that entry's span.
((list) @list (#set! "capture.list.definition" "true") (#set! "capture.list.selfNesting" "true") (#set! "capture.list.sharesSpan" "true"))

; paragraph: a run of body text, directly under a section, in a list entry or in a quote.
(section (paragraph) @paragraph (#set! "capture.paragraph.definition" "true") (#set! "capture.paragraph.omit" "continuation")) ; @priority
(list_item (paragraph) @paragraph)
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
; the first heading, so it is the page's own metadata (title, description). Its text is YAML, so its keys are yaml's @pair.
((minus_metadata) @frontmatter (#set! "capture.frontmatter.definition" "true") (#set! "capture.frontmatter.injection" "yaml"))

; table: the WHOLE pipe table as one element - header row, delimiter row and every body row. One
; per table; a table in a list entry or a quote is the same node and is captured the same way.
((pipe_table) @table (#set! "capture.table.definition" "true"))
