---
title: "Stateful comments"
description: "A rule that reviews this repo's own TypeScript: it finds a stateful comment, one that is true only today, so it can be rewritten to hold at any time."
sidebar:
  label: Stateful comments
---

# Stateful comments

[`is_comment_stateful`](../../../jint.config.ts) finds a stateful comment: one that narrates this repository's history - what the code used to do, a rename, a review, an issue or a date - so it is wrong once the code moves on. Past tense about what the program does when it runs, or about the outside world it depends on, is not history, and neither is a `@deprecated` tag.

```ts
import type { RuleSchema } from "jint:sdk";

const is_comment_stateful: RuleSchema = {
  name: "is_comment_stateful",
  kind: "noul",
  target: "comments",
  include: ["**/*.ts", "**/*.tsx"],
  instructions:
    "Does any comment in this unit narrate this repository's history instead of describing the code as it is? Judge only the comments, not the code.",
  criteria: {
    true: "At least one comment narrates this repository's history: what this code used to do, what replaced it, a rename, a removed feature, a past bug, a review, an issue or pull request, or a date - how the code got here rather than what it is. Read by someone who never saw the change, it would be wrong or meaningless.",
    false:
      "Every comment describes the code as it is. Past tense about the program's run (a request that failed, a file no worker could walk, a value the user entered), about the outside world the code depends on (an API that changed its format, a browser bug the code works around), and would or could about what would happen otherwise, are not history. A JSDoc `@deprecated` tag is TypeScript's standard deprecation notice and is not history, whatever history it tells: its reason and replacement are part of the notice. The same narration outside that tag is history.",
  },
  handle: {
    warn: { greater_than: 0.6 },
    error: {
      greater_than: 0.8,
      message: "Rewrite this comment to describe the code as it is, without its history.",
    },
  },
};
```
