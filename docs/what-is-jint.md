---
title: "What's jint?"
description: "jint is an extensible semantic linter. A rule is a plain-English question about your code; a classifier answers it, and a threshold turns the answer into a finding."
sidebar:
  label: "What's jint?"
---

# What's jint?

jint is an **extensible** semantic linter. A tool to replace code reviews.

jint reads your files, asks a decision model questions about specific parts of your code that
you or your agent previously set, and steers your agent with the findings.

What you ask, the captured code and how to handle the result of the classification is embedded in
the shape of a traditional linter, as [rules](what-are-rules.md).

## Your agent runs jint

jint is meant to be run by your agent, not by you. The agent writes code, runs jint over it, reads
the findings, and fixes them before it hands the work back, allowing it to check its own work.
