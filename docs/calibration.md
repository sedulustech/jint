---
title: Calibration
description: "How to test a rule and edit it until it is right: tests, reruns, and reading the undecided count."
sidebar:
  label: Calibration
---

# Calibration

Calibration is needed when creating a rule.
General rules (rules that encompass a set of dimensions) are harder to introduce in a codebase.
It's easier to create a rule that does something very specific in a given that file, than a rule
that aims to target multiple files simultaneously.
You want your rules to be precise.

Using a rule that prevents the agent from doing its work is the opposite effect of what we want to achieve.
There is a need for testing a rule and editing it until the result is beneficial.

When a rule has ambiguous classifications, edit its instructions or criteria. Do not change the
rule's action.

You can use the local UI to edit a rule's question next to the captured text, classify it, and compare
the classifications until the rule outputs what you mean.
In this case, your agent writes the rule's logic and you write the question and the evidence.

## Controls

A control is a small input with a known answer. Calibrate a rule on a few healthy controls and a few
defective ones. Where a high classification is good, the healthy ones read high and the defective ones read
low. Set the handle's thresholds inside the gap between the healthiest defective control and the
least healthy healthy one.

Controls show that a rule tells the cases apart. They do not show that it fires only when it needs
to. Run the rule over your real code as well.
