# Parity corpora

Per-language corpus files for `bun scripts/parity.ts <language>` — the structural comparison of
the query walker against the previous implementation (embed-all worktree, run live). The corpora
double as the regression corpus for extraction-policy changes; change a corpus only with the
parity verdict re-recorded here.

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
