# Parity corpora

Per-language corpus files for `bun scripts/parity.ts <language>` — the structural comparison of
the query walker against the previous implementation (embed-all worktree, run live). The corpora
double as the regression corpus for extraction-policy changes; change a corpus only with the
parity verdict re-recorded here.

## css (corpus.css, from the css field trial's stylesheet)

Verdict (Oct 15, second port): comments-only by decided policy — the trials' stretch mappings
(rule_set -> type, declaration -> binding) are retired; every stretch is a recorded WAITING in
queries.scm. Deltas vs the reference:

- REF-ONLY: all rule sets, declarations, @keyframes (stretched elements) — gone, honestly.
- NEW-ONLY: comments inside rule bodies become standalone elements — with no captured
  definitions, nothing contains them (the reference counted them internal to the stretched
  composite).
- @import is NOT captured: css imports are not code imports (no merge-run semantics); decide
  with the vocabulary, not by stretch.
- Legal result: a comments-only inventory; zero elements (a stylesheet without comments) is
  legal per grammar.

## tsx (corpus.tsx, from embed-all's port-corpus)

Verdict (Oct 15, third port): parity holds; the single delta is ABSORB on
`export function Counter` (wrapper span, identical element set). The tsx grammar shares the
typescript pattern set verbatim (same declaration node types; JSX stays inside them - the old
probe found no jsx_* node type at the top level). NAMES: the query patterns bind @name where the
reference produced nameless elements.

## python (corpus.py, from embed-all's port-corpus)

Verdict (Oct 15, fourth port): parity holds with two documented deltas:

- CLASS SPANS: the reference bounded a composite class to its declaration header
  (`class Config:`); the query element captures the class WHOLE (span = captured node; the size
  backstop guards the budget). Methods and docstrings identical.
- NAMES: @name binds everywhere (the reference produced nameless elements on this corpus).

Docstrings: the string-in-block convention moved into the grammar dir - the .scm captures the
docstring, the manifest's docstringNodeTypes fact tells the walker which captured comments are
docstrings, and the walker owns them (docstringOf: innermost containing definition, or module).
Decorated definitions absorb their decorator (wrapper = element).

## go (corpus.go, from embed-all's port-corpus)

Verdict (Oct 15, fifth port): parity holds; NAMES is the only delta (@name on functions, methods,
single-spec const/var/type blocks - the anchor pattern `. (spec) .` names a block only when it
declares exactly one spec, keeping multi-spec blocks honestly nameless). Package-level bindings
present (a consts-only package file yields elements); doc comments attach as leading runs.

## php (corpus.php, from the php field trial's sample)

Verdict (Oct 15, ninth port): parity holds with documented deltas:

- NAMES: @name binds php's universal `name` node - the trial's names blocker dies; every
  definition renders named.
- CLASS SPAN: whole class (span = captured node); the reference header-bounded it.
- CLOSURES RETIRED: the trial's anonymous_function/arrow_function -> function stretch is dead;
  a closure assignment is an honest NAMED binding ($pricer, $maker) - the declarator-free
  callable-initializer question the trial flagged is answered by the honest noun.
- include/require stay transit (runtime control flow; the trial's own verdict).
- Member data ($stock) stays inside its class - WAITING on the field capture.

## cpp (corpus.cpp, from the cpp field trial's sample, plus template fixtures)

Verdict (Oct 15, eighth port): parity holds with documented deltas:

- TEMPLATE ABSORB: `template<typename T> class Box {};` captures the whole template_declaration
  (the policy table's type absorbTail=2 swallows the trailing ';' - the shape test the review
  asked for); the reference header-bounded to `class Box`. Template functions likewise absorb,
  carrying the template line in the span and the declared name via descent.
- NAMES everywhere; the trial's field stretch is dead - member function prototypes surface as
  functions (field_declaration priority split), member DATA fields stay WAITING (field).
- REF-ONLY: macros (invisible to the grammar - a grammar fact), namespace (transit; its
  functions surface on their own), the old merged-import run (our import element stops at the
  last #include).

## c (corpus.c, from the c field trial's sample)

Verdict (Oct 15, seventh port): parity holds with three documented deltas:

- NAMES everywhere: enum/struct/typedef/declarations bind @name (the reference was nameless);
  names descend through pointer declarators (`struct Ring *f(void)`).
- PROTOTYPE SPLIT: the trial's STRETCH (prototypes as bindings) is dead - pattern priority on
  function_declarator roots splits a declaration-with-declarator into a function unit;
  state declarations stay bindings. The split is stated with @priority directives and enforced
  by the load-time pattern-order validator.
- STRUCT SPAN: the reference bounded a composite struct to its header; the query element carries
  the whole body (span = captured node; fields stay inside, WAITING on the future field capture).

## markdown (corpus.md, from the markdown field trial's sample)

Verdict (Oct 15, sixth port): sections-only by decided policy; every retired stretch is a
WAITING in queries.scm (prose, code-block, link-reference). Deltas vs the reference:

- NAMES: sections carry their heading text (the reference rendered them nameless). The name is
  raw inline source — itself a stretch; WAITING for a text-name capture.
- SPAN TAIL: our section spans include the file's trailing newline (one byte; key-mismatch
  only).
- REF-ONLY: fenced code blocks (the trial's worst stretch, function), paragraphs, quotes, link
  references — the stretches retired; the trial's own verdict was that they die inside a section
  anyway.

SHAPE NOTE (policy seam from this port): markdown forced sameCaptureNesting into the manifest —
its sections genuinely nest; the wrapper-absorb collapse in the policy table (query.ts) is off
for this grammar.

## typescript (corpus.ts, from embed-all's port-corpus)

Verdict (Oct 15, first query port): parity holds — every reference element has a counterpart.
Deltas, all documented policy:

- ABSORB: `export function/class/const` elements carry the wrapper's span (the reference kept the
  wrapper span too — identical extents); the class is captured WHOLE (`span = captured node`),
  where the reference bounded a composite's span to its declaration header. The size backstop
  replaces header bounding as the token-budget guard.
- DESCENT: a `@function`/`@binding` interior is opaque (the reference only surfaced what composite
  descent reached); a `@type` interior surfaces (methods), as before.
- WAITING: `describe`/`it` call composites are no longer elements — the reference stretched every
  top-level call to the function noun. Needs contextual refinement (a call is a definition only
  when its callback carries declarations); recorded in queries.scm, not stretched.
- NAMES: the reference produced nameless elements on this corpus; the query patterns bind @name
  for every definition (the 6-language name evidence, applied).
