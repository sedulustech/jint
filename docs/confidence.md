---
title: Decidedness and confidence
description: "The two axes of a choice classification, decidedness and confidence, and what each one tells you."
sidebar:
  label: Confidence
---

# Decidedness and confidence

A choice question has a tier and a decidedness.

- **Tier:** the verdict. It is the tier with the most probability. A tier's mass is the sum of its
  options' probabilities.
- **Decidedness:** whether the verdict is stable. It compares the top tier's mass with the
  runner-up tier's mass.

## Undecided

A choice is undecided when the top tier leads the runner-up by less than `margin`. With two
tiers, `margin: 0.2` makes a top tier under 0.60 undecided.

Undecided is not a severity. It says the rule, in it's current state, is not helpful enough. The
response is to recalibrate the rule, not to act on the code. See [calibration](calibration.md).

Set `margin` per rule, from how far that rule's classifications move between reruns.

## The provider's confidence

A score or choice answer can carry `confidence`: the provider's own number, 0 to 1. jint does not
derive it from the probabilities, and no verdict reads it.

jint reports this in `--json` and on the run view's answer card.
