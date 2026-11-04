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

What we ask, the captured code and how to handle the result of the classification is embedded in
the shape of a traditional linter, as rules.

## Rules

A rule is a question about your code, written in plain English. It contains the questions
you want to ask, what to target with that question, and how to handle a failure or warning for
that specific question.

You can target anything as long as it's text. Given that it's built on top of treesitter, you
can bring your own language grammar, allowing you to capture the exact part of your code you
want to classify.

```ts
export default {
  rules: {
    use: [
      {
        name: "is_name_purposeful",
        instructions: "Does this function's name say what the function does?",
        criteria: {
          true: "The name states the function's purpose.",
          false: "The name is generic, or names a different job from the one the body does.",
        },
        target: "functions",
        handle: {
          warn: { less_than: 0.6 },
          error: { less_than: 0.3, message: "Rename this function after what it does." },
        },
      },
    ],
  },
};
```

## Your agent runs jint

jint is meant to be run by your agent, not by you. The agent writes code, runs jint over it, reads
the findings, and fixes them before it hands the work back. That is how it checks its own work.
