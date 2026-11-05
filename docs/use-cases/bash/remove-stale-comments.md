---
title: "Remove stale comments"
description: "A rule that reviews this repo's own shell scripts: it finds a stale comment, one that states something the code in the same file contradicts."
sidebar:
  label: Remove stale comments
---

# Remove stale comments

`is_comment_contradictory` finds a stale comment: one that states something the code in the same file contradicts.

```ts
import type { RuleSchema } from "jint:sdk";

const is_comment_contradictory: RuleSchema = {
  name: "is_comment_contradictory",
  kind: "noul",
  target: "files",
  include: ["**/*.sh"],
  instructions:
    "This unit is one source file. Does any comment in this file state something about what the code does, where it reads from, or how it is used, that the code in this same file contradicts?",
  criteria: {
    true: "At least one comment makes a claim the code in this file contradicts: it names a source, destination, default, option, command or behavior that the code does not have or has changed - a header describing an old download location, a usage line for a flag the code no longer reads, a doc comment promising a return the body never makes. A comment that is merely vague, narrates the obvious, or is out of date about something the file does not show is not a contradiction.",
    false:
      "Every comment is consistent with the code: what it claims about behavior, defaults, options and usage is what the code does, or it makes no checkable claim about the code at all.",
  },
  handle: {
    warn: { greater_than: 0.5 },
    error: {
      greater_than: 0.9,
      message:
        "A comment says something the code in this file contradicts: fix the comment or the code.",
    },
  },
};
```
