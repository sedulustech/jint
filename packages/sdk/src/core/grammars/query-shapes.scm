; File header: the first comment run documents the file.
; A second header line joins the same run.

; a comment above a pattern
(pair key: (_) @key value: (_)? @value) @pair ; trailing comment after a pattern
(note) @note
; a comment between two patterns, split from the one above by no blank row
"=" @operator
[(a) "b"]+ @alt
((c . (d) @inner) (#set! "capture.c.merge" ";not a comment"))
(MISSING identifier) @missing
(_) @any
(#eq? @key "value")
(outer
  ; a comment inside a pattern
  (inner) @inner)

; a run split by a blank row

; is a second element
(e/f) @supertype
; a comment at the end of the file
