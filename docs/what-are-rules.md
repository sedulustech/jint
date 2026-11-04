---
title: "What are rules?"
description: "A rule is stronger than a rubric: jint runs it after generation, and nothing checks that an agent applied a rubric."
sidebar:
  label: "What are rules?"
---

# Rules

A rule is a question about your code, written in plain English. It contains the question
you want to ask, what to target with it, and how to handle a failure or warning if the answer
does not pass the criteria.

A jint rule is run after generation, in CI or in a pre-commit hook, making sure the user intention is enforced.
This makes a rule stronger than a rubric. A rubric is text the agent reads and applies by its own judgment,
but nothing checks that it did.

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
