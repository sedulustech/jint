# Test fixtures

Checked-in, deterministic fixtures for the component tests (src/*.test-browser.tsx).
Every fixture is hand-maintained: edit the files directly.

## Layout

- `run-a/` - 17 captures + `report.json` + `manifest.json`. The main fixture. Covers STATES,
  not a corpus:
  - 5 rules: a normal name (`is_name_purposeful`), a greedy-parser breaker
    (`has_nothing in mind` - would corrupt the old greedy `/^(.*) in (.+)` question-key
    parse, the regression that motivated the canonical-rule fix), a distinct name
    (`will_comment_drift`), a score-kind rule (`will_error_lose_cause`, value indexes the
    map), and the acceptance-polarity rule (`is_noul_documented`, fires_when "false").
  - answer edges: borderline (0.50, 0.51, 0.45), high (0.92, 0.95), low (0.08, 0.20, 0.30).
  - one multi-question capture (two rules on one element, elements tier / `state.source`).
  - one refused reading (`will_error_lose_cause` at src/refused.ts: the answer is `{type:"refusal"}`,
    the report classification is `refused: true` - no value, no verdict).
  - one recording with a sent request body under the old field name `wire` (`borderline.ts`, the translated Decisions body); every
    other legacy capture predates request-body capture and has none (the request view's fallback).
  - one recording in the decisions form (`decisions.ts`, `is_name_purposeful` at 0.35): the real
    POST /v1/decisions bodies (a `questions` array, an `answers` array, `questionIds`), no
    legacy shape and no sent body; it has no report classification, so it is a request and no cell.
  - one capture with NO questions (rules `()` - stays visible unfiltered, exercises the
    empty-rules path).
  - severity states via the manifest handle snapshot: high-p-under-fires_when:"false" renders
    NEUTRAL (high.ts 0.92, documented.ts 0.80 - the acceptance case), pole flip renders error
    (low.ts 0.08 under fires_when:"false"), silent-band capture renders no verdict (greedy.ts
    0.80 inside [0.75, 0.85]), score value 3 renders error. Findings agree with the projection
    where both exist (borderline.ts warn).
- `018bcfe5-6801-7000-8000-00000000000b/` - 3 captures, deliberately NO `manifest.json`: a run still recording. Its id is a
  UUIDv7, so its start is read from the id.

## Editing

`run-a/` and the manifest-less run mix the recorded forms (legacy, legacy with `wire`, decisions) on purpose.
When a fixture changes, re-pin the constants at the top of `src/rule-filter.test-browser.tsx`
(TOTAL / RULE_COUNTS / BORDERLINE_COUNT) to whatever the fixture contains. The engine's own
output is checked end to end by tests/element-capture-e2e.test.ts at the repository root.

## Pinned expectations

| filter                | rows |
| --------------------- | ---- |
| (none)                | 17   |
| is_name_purposeful    | 6    |
| has_nothing in mind   | 3    |
| will_comment_drift    | 2    |
| is_noul_documented    | 1    |
| will_error_lose_cause | 1    |
| borderline band       | 4    |
