# jint — classification strategies

Every shape of (state, questions) we have sent to jev, what happened, and why it stayed or died.
Dates ~2026-09-22..24, branch feat/criteria-rule unless noted. Section 9 of tmp/design.md,
promoted here as the canonical strategies record; new strategies are added here when tried.

## The law that fell out

One state x many questions: VALID. Many states x many questions in one call (the matrix): INVALID -
the model answers the average for every cell. See tmp/design.md appendix B, "Measurement shape law".

## Strategies at a glance

| #   | strategy                               | shape                                                                | verdict                                                                   |
| --- | -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | Whole-file single call                 | state = {path, content}; 1 question per file-scoped rule             | kept, unit-scoped rules only                                              |
| 2   | Two-stage funnel (sweep -> confirm)    | anchored batch picks candidates; isolated re-ask fires               | dead - censored 38 real findings, killed 63, +50% calls                   |
| 3   | Sweep-anchor thresholds                | SWEEP_THRESHOLDS + HIGH_GOOD gate candidacy                          | dead with the funnel; handles are the only thresholds                     |
| 4   | Matrix form                            | array state {path, elements} + "<rule> in <id>" questions, <=50/call | banned - averages (noul pinned 0.61-0.66; content ignored)                |
| 5   | Per-element source state               | state = {path, source}; rules batched in-call; ELEMENT_CONCURRENCY=8 | CURRENT - honest readings, +18% wall over the matrix                      |
| 6   | Batch-size ablations                   | batched vs 1q/call vs by-rule batches                                | identical within a state shape; chunk size = cost lever                   |
| 7   | Model swap (gemini flash-lite)         | same seam, different model                                           | rejected - quantized answers, 80% agreement; noul calibration is the moat |
| 8   | Criteria-as-rule                       | criteria {true,false} replaces prose description                     | kept - 0.82+/-0.012 vs 0.77+/-0.019 on the calibration probe              |
| 9   | Scored rubrics (choice kind)           | criteria = ordered 0..3 legend; answer = score                       | new - discriminates 0.19 vs 2.49; is_readable ships on it                 |
| 10  | Per-file extreme aggregation           | max/min by polarity, one finding per (file, rule)                    | dead - hid the element distribution; per-element findings won             |
| 11  | Content-hash wire ids -> LOC intervals | sha256/8hex -> L19-L28                                               | LOC kept (grep-able reports); hash survives only for diffs                |

## The strategies in detail

## Precision timeline (self-lint ground-truthing)

- selflint2 (matrix form, corrupted-then-fixed task sentence): verifier-1 (context-heavy) said 4%
  real; blind deepseek sample said ~19-31%; the discrepancy itself flagged verifier bias and
  comment-rule span mislocation.
- selflint3 (per-element source state): 53% FP on a 17-signal top-value sample - the FP patterns
  (smallness=read-as-purposelessness, blanket narration, interface-pinning-as-drift) reproduce
  under honest measurement: they are criteria defects, not measurement defects. Fix order in tmp/verification.md.
