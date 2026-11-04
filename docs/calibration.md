---
title: Calibration
description: "How to test a rule and edit it until it is right: tests, reruns, and reading the undecided count."
sidebar:
  label: Calibration
---

# Calibration

Calibration is testing a rule and editing it until it is right. A test is one rule version, run
two times on the same inputs. Compare tests by their undecided count. Undecided readings show
where the options do not separate the code.

When a rule has many undecided readings, edit its instructions or criteria. Do not change the
rule's action.

The goal is rules calibrated to your code, so that they fire only when they need to. A rule that
reads wrongly blocks good work or lets bad work pass.

Your agent can create rules, but it's better if you did. Think of it as automated steering and verification.
You want your rules to be precise.

You can use the local UI to edit a rule's question next to the captured text, classify it, and compare
the readings until the rule judges what you mean.
Your agent writes the rule's logic and you write the question and the evidence.

## Example: is_comment_justified

Five versions of this rule each ran twice over 95 units of one corpus, with `margin: 0.2`. Each
version left 13 to 24 units undecided. Two runs of one version differ by up to 5, so no version
separated the units cleanly.

The request files hold the exchanges for each version: [v5](calibration/v5.request.json),
[v9](calibration/v9.request.json), [v10](calibration/v10.request.json),
[v11](calibration/v11.request.json) and [v12](calibration/v12.request.json).

One unit stayed undecided in every version. Most of its error mass sat on one option,
`wording_unmapped`.
