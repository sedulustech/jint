---
title: Replacing code reviews
description: "Turn a reviewer's repeated comments into rules that run on every change, so the output is correct from the start."
sidebar:
  label: Replacing code reviews
---

# Replacing code reviews

jint moves the code review to the implementing agent.

Developers use memory or skills to guide an agent from making mistakes and to guide its output.
Instead of guiding, we need to enforce and verify.
"This name says nothing." "This comment repeats the code." Each one is a
question about the code, so each one can be a [rule](what-are-rules.md).

Instead of writing the same prompt a second time, write the rule instead.
The engineer's judgment becomes a rule.

If you use jint in a [pre-commit hook or in CI](how-to-use.md#pre-commit-and-ci), a violated rule
fails the hook, telling the agent what to fix. The agent corrects the code before a reviewer
sees it, so the output is correct from the start.
