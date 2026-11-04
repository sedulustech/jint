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

## Controls

A control is a small input with a known answer. Calibrate a rule on a few healthy controls and a few
defective ones. Where a high reading is good, the healthy ones read high and the defective ones read
low. Set the handle's thresholds inside the gap between the healthiest defective control and the
least healthy healthy one.

Controls show that a rule tells the cases apart. They do not show that it fires only when it needs
to. Run the rule over your real code as well, and spot-check what fires.
