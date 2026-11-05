---
title: Replacing code reviews
description: "Turn a reviewer's repeated comments into rules that run on every change, so the output is correct from the start."
sidebar:
  label: Replacing code reviews
---

# Replacing code reviews

A code review catches what a reader notices after the code is written. jint moves the check
earlier: a reviewer's judgment becomes a rule, and the rule runs on every change, as the code is
generated.

Review comments repeat. "This name says nothing." "This comment repeats the code." Each one is a
question about the code, so each one can be a [rule](what-are-rules.md). When you write the same
comment a second time, write the rule instead.

A rule runs after generation, in a [pre-commit hook or in CI](how-to-use.md#pre-commit-and-ci). An
error fails the hook, and the rule's message tells the agent what to fix. The agent corrects the
code before a reviewer sees it, so the output is correct from the start.

A person still chooses the rules and checks that they judge what was meant. See
[calibration](calibration.md).
