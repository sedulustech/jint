---
title: Decidedness and confidence
description: "The two axes of a choice reading, decidedness and confidence, and what each one tells you."
sidebar:
  label: Confidence
---

# Decidedness and confidence

A choice reading has a tier and a decidedness.

- **Tier:** the verdict. It is the tier with the most probability. A tier's mass is the sum of its
  options' probabilities.
- **Decidedness:** whether the verdict is stable. It compares the top tier's mass with the
  runner-up tier's mass.

## Undecided

A reading is undecided when the top tier leads the runner-up by less than `margin`. With two
tiers, `margin: 0.2` makes a top tier under 0.60 undecided.

Undecided is not a severity. It says the reading does not decide, not how bad the code is. The
response is to recalibrate the rule, not to act on the code. See [calibration](calibration.md).

Set `margin` per rule. On the earlier classifier, the margin moved by 0.04 at p50, 0.12 at p90 and
0.24 at p99 across reruns of one test.

## The provider's confidence

A score or choice answer can carry `confidence`: the provider's own number, 0 to 1. jint does not
derive it from the probabilities, and no verdict reads it.

jint reports it in `--json` and on the run view's answer card. It is absent when the provider
returns none.

## CI

An undecided reading must not fail a build, because its tier changes between runs. In 43 tier
changes across nine runs, each change had an undecided reading on one side. A build that fails only
on decided readings does not flake.

## Limits

- `margin: 0.2` is not fitted to labeled data. We chose it on two TypeScript corpora.
- The measurements come from `jev-1.13.0`, which jint no longer asks. The default model is
  `gpt-6-luna`, so recalibrate the margin on its readings.
- The classifier has no default threshold. Set one per question.
