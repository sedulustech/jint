---
title: Replacing code reviews
description: "Turn a reviewer's repeated comments into rules that run on every change, so the output is correct from the start."
sidebar:
  label: Replacing code reviews
---

# Replacing code reviews

We use memory or skills to prevent an agent from making mistakes and to guide its output.
Instead of preventing, we need to enforce and verify.
"This name says nothing." "This comment repeats the code." Each one is a
question about the code, so each one can be a [rule](what-are-rules.md). When you write the same
comment a second time, write the rule instead.

jint moves the code review to the implementing agent.
A reviewer's judgment becomes a rule, and the rule runs on every change, as the code is
generated.

If you use jint in a [pre-commit hook or in CI](how-to-use.md#pre-commit-and-ci), a violated rule
fails the hook, and the rule's message tells the agent what to fix. The agent corrects the
code before a reviewer sees it, so the output is correct from the start.

A person still chooses the rules and checks that they judge what was meant. See
[calibration](calibration.md).
