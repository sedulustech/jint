; markdown: extraction patterns over tree-sitter-markdown 0.5.3 (block grammar; `inline`
; parses as empty external stubs and is transit anyway).
;
; Under the frozen five, exactly ONE honest capture exists: the section. A heading plus
; everything under it is markdown's only container-with-body; section -> @type is the trial's
; one defensible mapping. Its name is its heading text (atx_heading > inline) - a real
; name, not an identifier hunt; the reference walker rendered sections nameless.
;
; WAITING on vocabulary growth (the design's ledger; retired stretches from the trial):
; - prose (paragraph, setext_heading, block_quote, html_block): the trial stretched them to
;   comment, then watched every paragraph die inside a section (the comment lane never emits
;   inside a composite). Prose needs its own noun - a silent inventory beats a poisoned frame.
; - code-block (fenced_code_block, indented_code_block): the trial's worst stretch (function);
;   an embedded machine-read unit deserves its own capture.
; - link_reference_definition: the trial stretched it to import; it is not a code import and
;   would vanish into the merge-run anyway.
; - list, list_item, pipe_table*, thematic_break, atx_heading: transit under every mapping so
;   far - none is a judged unit under any noun, and a table row judged alone is noise.

(section (atx_heading (inline) @name)) @type
(section) @type
