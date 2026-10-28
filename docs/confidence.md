# Decidedness and confidence

A choice reading has two axes:

| axis        | question               | source                                                |
| ----------- | ---------------------- | ----------------------------------------------------- |
| tier        | What is the verdict?   | the tier with the most probability                    |
| decidedness | Is the verdict stable? | the top tier's mass against the runner-up tier's mass |

A tier's mass is the sum of its options' probabilities. jint measures the top tier, because the
tier is the verdict.

## The provider's confidence

A score or choice answer can carry `confidence`: the provider's own number, 0 to 1. It is not
the top probability. It is not derived from the probabilities, and its formula is undocumented.
In live checks, a clear score gave 1.0, a split 0.60 / 0.37 / 0.03 gave 0.36, and an ambiguous
choice split 0.43 / 0.09 / 0.48 gave 0.22.

jint reports it beside the reading: on the measurement and the finding in `--json`, and as a
caption on the run view's answer card. It is absent when the provider returns none, as the
gateway's native endpoint does. No verdict reads it. Decidedness, computed from the tier
masses, is the only measure of whether a verdict is stable.

## Undecided

A reading is undecided when the top tier's mass leads the runner-up tier's mass by less than
`margin`. With two tiers, `margin: 0.2` makes a top tier under 0.60 undecided.

The margin is in probability units, the same units as the variation measured on the earlier
classifier, jev. jev did not return the
same probabilities for the same request: a byte-identical request moves by about 0.02. Across
reruns of one test on jev, the margin moved by:

| percentile | is_comment_justified (913 pairs) | is_class_cohesive (33 pairs) |
| ---------- | -------------------------------- | ---------------------------- |
| p50        | 0.04                             | 0.04                         |
| p90        | 0.12                             | 0.10                         |
| p99        | 0.24                             | 0.22                         |

Set `margin` from these numbers, per rule. A reading with a larger lead keeps its tier on a
rerun. A reading near the margin can still change between undecided and decided.

Undecided is not a severity. It does not say how bad the code is. It says that the reading
does not decide.

The default response to an undecided reading is recalibration, not an action on the code. See
[calibration](calibration.md).

## CI

An undecided reading must not fail a build. Its tier changes between runs on the same input.

The table counts tier changes between two runs of the same config on the same inputs. All
counts use `margin: 0.2`.

| test | corpus | readings | tier changes | changes between two decided readings |
| ---- | ------ | -------- | ------------ | ------------------------------------ |
| v5   | sdk    | 95       | 3            | 0                                    |
| v9   | sdk    | 95       | 3            | 0                                    |
| v10  | sdk    | 95       | 3            | 0                                    |
| v11  | sdk    | 95       | 4            | 0                                    |
| v12  | sdk    | 95       | 4            | 0                                    |
| v10  | app    | 65       | 3            | 0                                    |
| v11  | app    | 65       | 2            | 0                                    |
| v12  | app    | 65       | 6            | 0                                    |
| v12  | t3code | 243      | 15           | 0                                    |

43 readings changed tier. Each change had an undecided reading on at least one side. When CI
fails only on decided readings, these runs do not flake.

## Limits

- `margin: 0.2` is not fitted to labeled data. We chose it on two TypeScript corpora.
- These measurements come from `jev-1.13.0`, a model jint no longer asks. The default model is
  `gpt-6-luna`, so recalibrate the margin on its readings before relying on it.
- The classifier gives no default threshold. Its examples use different floors (0.5, 0.6), so set a
  threshold per question.
