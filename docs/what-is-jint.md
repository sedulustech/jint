---
title: "What's jint?"
description: "jint is a semantic linter. A rule is a plain-English question about your code; a classifier answers it, and a threshold turns the answer into a finding."
sidebar:
  label: "What's jint?"
---

# What's jint?

jint is a semantic linter.

jint reads your files, asks a classifier questions about specific parts of your code
and turns the number that comes back into a finding when it crosses the configured threshold.

What you ask, the captured code and how to handle the result of the classification is embedded in
the shape of a traditional linter, as rules.

## Your agent runs jint

jint is meant to be run by your agent, not by you. The agent writes code, runs jint over it, reads
the findings, and fixes them before it hands the work back. That is how it checks its own work.
