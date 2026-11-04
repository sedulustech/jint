---
title: Pre-commit and CI
description: "Embed jint in a pre-commit hook or CI: the rule's handle gives the agent an action, and an error fails the hook."
sidebar:
  label: Pre-commit and CI
---

# Pre-commit and CI

jint is a CLI, so you can embed it in the part of the pipeline you find most suitable: CI or a pre-commit hook.
A pre-commit hook is advised as it returns an action for the agent to take: the rule's handle gives a severity and
a message that says what to do. An error fails the hook and sets the exit code, so the agent has
to act on it before the work goes through.
