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

## Scope

A rule reads the files its scope allows. `rules.include` and `rules.exclude` set the default scope
for every rule. A rule's own `include` and `exclude` replace it for that rule, and exclude always
wins. A rule about React components, for example, should only read `**/*.tsx` files.

## Custom rules

A declarative rule asks the same question of every element. When the answer needs more than the
element, write `state(self, ctx)`. It runs once for each captured element and returns the parts the
classifier reads. Each element has a `name`, its `source`, its `parent` and its `children`.
`ctx.file` is the file the element sits in: its `path`, its `source`, and its `elements` in file
order. A part that is empty for some elements is reported after the run.

When the question itself changes from one element to the next, write `classify(self, ctx)` instead.
It returns the instructions, the criteria and the state.

A rule with a `state` or `classify` function, a function `target` or a function `handle` is a custom rule. It
works only in `jint.config.ts`, and declarative rules beside it compile as usual.

```ts
import { defineConfig } from "jint:sdk";

export default defineConfig({
  rules: {
    use: [
      {
        name: "is_method_in_its_class",
        target: "methods",
        instructions: "Does this method belong in the class that contains it?",
        criteria: {
          true: "The method works on what the class models.",
          false: "The method does a different job from the one the class models.",
        },
        state: (self) => ({
          method: self.source,
          class: self.parent?.name,
        }),
        handle: { warn: { less_than: 0.6 }, error: { less_than: 0.3 } },
      },
    ],
  },
});
```

A `handle` function, `(results, ctx) => decisions`, runs once after classification. It returns one
decision: `{ severity: "error" | "warn" | null, message? }`. A `null` severity is
silent, and the `message` tells the caller how to fix the finding.

On a Python class `Invoice`, the classifier reads `def total` as part of the invoice and
`def send_email` as a different job. A declarative rule cannot see the class.
