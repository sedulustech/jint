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
