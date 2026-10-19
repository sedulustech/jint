; SHADOW FIXTURE for the BYOG e2e (tests/byog-markdown.test.ts) — NOT the embedded markdown
; extraction. This dir is named for the embedded grammar id "markdown" and holds NO wasm: it
; SHADOWS the embedded grammar's extraction only (the embedded wasm still parses the file). The
; patterns are a deliberate inversion of the embedded mapping — @section is assigned to paragraph
; nodes (the embedded .scm assigns it to heading sections) — so a run's measured spans prove WHICH
; .scm governed extraction. See docs/byog.md for the seam contract.
(paragraph) @section (#set! "capture.section.definition" "true")
