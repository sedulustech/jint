---
title: "Stateful comments"
description: "A rule that reviews this repo's own TypeScript: it finds a stateful comment, one that is true only today, so it can be rewritten to hold at any time."
sidebar:
  label: Stateful comments
---

# Stateful comments

`is_comment_stateful` finds a stateful comment: one that says now, currently or no longer, or narrates the history of a change, so it is wrong once the code moves on.

```ts
import type { RuleSchema } from "jint:sdk";

const is_comment_stateful: RuleSchema = {
  name: "is_comment_stateful",
  kind: "noul",
  target: "comments",
  include: ["**/*.ts", "**/*.tsx"],
  instructions:
    "Does any comment in this unit depend on when it is read? Judge only the comments, not the code.",
  criteria: {
    true: "At least one comment is stateful: it says now, currently, recently, no longer, used to, previously or we just, or it narrates history (a rename, a removed feature, a past bug, a review or a date, the old X) instead of what the code is. Read a year later, or by someone who never saw the change, it would be wrong or meaningless.",
    false:
      "Every comment is stateless: it says what the code does or why, in terms that hold at any time and need no memory of how the code got here.",
  },
  handle: {
    warn: { greater_than: 0.5 },
    error: {
      greater_than: 0.8,
      message:
        "Rewrite this comment so it reads the same at any time: no now, currently or no longer, no history of the change.",
    },
  },
};
```
