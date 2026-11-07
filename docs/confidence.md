---
title: Decidedness and confidence
description: "The two axes of a choice classification, decidedness and confidence, and what each one tells you."
sidebar:
  label: Confidence
---

# Decidedness and confidence

A choice classification has a tier and a decidedness.

- **Tier:** the verdict. It is the tier with the most probability. A tier's mass is the sum of its
  options' probabilities.
- **Decidedness:** whether the verdict is stable. It compares the top tier's mass with the
  runner-up tier's mass.

## Undecided

A classification is undecided when the top tier leads the runner-up by less than `margin`. With two
tiers, `margin: 0.2` makes a top tier under 0.60 undecided.

Undecided is not a severity. It says the classification does not decide, not how bad the code is. The
response is to recalibrate the rule, not to act on the code. See [calibration](calibration.md).

Set `margin` per rule, from how far that rule's classifications move between reruns.

## The provider's confidence

A score or choice answer can carry `confidence`: the provider's own number, 0 to 1. jint does not
derive it from the probabilities, and no verdict reads it.

jint reports it in `--json` and on the run view's answer card. It is absent when the provider
returns none.

## CI

An undecided classification must not fail a build, because its tier can change between runs. A tier
change needs a near tie, and a near tie is an undecided classification. A build that fails only on decided
classifications does not flake.

## Limits

- `margin: 0.2` is an example, not a fitted value. Choose a margin per rule from its own reruns.
- The classifier has no default threshold. Set one per question.
