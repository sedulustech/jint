---
title: "Keep a skill complete"
description: "A rule that reads a skill file and flags it when it no longer says one thing it has to say, so an edit cannot drop it unnoticed."
sidebar:
  label: Skills
---

# Keep a skill complete

[`lacks_probability_meaning`](../../../skills/rules.ts) flags the writing-rules skill when no sentence says what a reading means, one rule for each thing the skill must say.

```ts
import type { RuleSchema } from "jint:sdk";

const lacks_probability_meaning: RuleSchema = {
  name: "lacks_probability_meaning",
  target: "files",
  instructions:
    "Does this skill fail to say that a reading is the model's probability that the answer is true, that it carries meaning, and that 0.5 is undecided? The skill says it when a sentence of its body says it in any wording. Judge only the body under the title; the front matter is not judged.",
  criteria: {
    true: "No sentence of the body says a noul reading is a probability that carries meaning: near 1 a strong lean to yes, near 0 a strong lean to no, and 0.5 undecided, or the body says the opposite.",
    false:
      "A sentence of the body says a noul reading is a probability that carries meaning: near 1 a strong lean to yes, near 0 a strong lean to no, and 0.5 undecided, in any wording.",
  },
  include: ["skills/writing-rules/SKILL.md"],
  handle: {
    warn: { greater_than: 0.5 },
    error: {
      greater_than: 0.75,
      message: "Say what a reading means and that 0.5 is undecided.",
    },
  },
};
```
