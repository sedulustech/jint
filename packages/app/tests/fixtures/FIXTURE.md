# Test fixtures

Checked-in, deterministic fixtures for the component tests (src/*.test-browser.tsx).
Generated files - do not hand-edit; regenerate instead.

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
    the report measurement is `refused: true` - no value, no verdict).
  - one recording with a `wire` request (`borderline.ts`, the translated Decisions body); every
    other capture predates wire capture and has none (the request view's fallback).
  - one recording in the decisions form (`decisions.ts`, `is_name_purposeful` at 0.35): the real
    POST /v1/decisions bodies (a `questions` array, an `answers` array, `questionIds`), no
    System One shape and no `wire`; it has no report measurement, so it is a request and no cell.
  - one capture with NO questions (rules `()` - stays visible unfiltered, exercises the
    empty-rules path).
  - severity states via the manifest handle snapshot: high-p-under-fires_when:"false" renders
    NEUTRAL (high.ts 0.92, documented.ts 0.80 - the acceptance case), pole flip renders error
    (low.ts 0.08 under fires_when:"false"), silent-band capture renders no verdict (greedy.ts
    0.80 inside [0.75, 0.85]), score value 3 renders error. Findings agree with the projection
    where both exist (borderline.ts warn).
- `run-b/` - 3 captures, deliberately NO `manifest.json`: the legacy-skipped state (hidden
  by the picker, counted in the header note).

## Generated case fixtures (fixture-pipeline)

New edge cases ship as GENERATED runs: the generator runs the real engine pipeline
(walk -> classify -> provider tap -> engine report/manifest writers) against a checked-in source dir:

- `sources/elements/` — real TS input (complex.ts + helpers.ts, nested functions).
- `generated/elements/` — the run it produced: captures + report.json + manifest.json. Served
  by the API as the nested run id `generated/elements`.

Regenerate deliberately: `bun run fixtures:gen`. The only stub is the transport (fixed per-rule
answers, like the engine's own lint tests). Regeneration is byte-identical: the builder seals the
engine's per-run entropy (uuid minting, timestamps, run-id filename stamps) behind sentinels —
tests/fixture-determinism.test.ts proves it. Tests still assert shapes and relationships, never
uuids.

## Regenerate

Two builders, two fixture kinds (both run from packages/app):

```bash
bun run fixtures:build   # tests/helpers/build-fixture.ts - synthesized run-a / run-b states fixture
bun run fixtures:gen     # scripts/build-fixture.ts      - generated/<case> runs through the real engine
```

The fixtures are synthesized by the script (not sampled from a live dump), so regeneration is
identical on any machine (the manifest's configPath is a synthetic absolute). When the dump
format changes, update the capture shape in the script and re-run it, then re-pin the constants
at the top of `src/rule-filter.test-browser.tsx` (TOTAL / RULE_COUNTS / BORDERLINE_COUNT) to
whatever the new fixture contains.

## Pinned expectations (kept in sync with the generator)

| filter                | rows |
| --------------------- | ---- |
| (none)                | 17   |
| is_name_purposeful    | 6    |
| has_nothing in mind   | 3    |
| will_comment_drift    | 2    |
| is_noul_documented    | 1    |
| will_error_lose_cause | 1    |
| borderline band       | 4    |
