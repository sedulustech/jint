---
title: "Keep use cases short"
description: "A rule that reviews this site's own docs: a use case says what the rule does in one sentence and shows the rule."
sidebar:
  label: Keep use cases short
---

# Keep use cases short

[`has_extra_content`](../../../web/rules/docs.ts) flags a use-case or example page that says more than one sentence before the rule.

```ts
import type { RuleSchema } from "jint:sdk";

const has_extra_content: RuleSchema = {
  name: "has_extra_content",
  target: "files",
  instructions:
    "Besides its heading and the rule in a code block, does this use-case or example page say more than one short sentence about what the rule does?",
  criteria: {
    true: "The page says more than one short sentence of its own: it states where the rule ships or how to import it, shows an example of the code the rule judges, argues why a syntax check cannot do the job, or adds a section on calibration, readings or limits.",
    false:
      "Under its heading the page has one short sentence on what the rule does, and then the rule in a code block.",
  },
  handle: {
    warn: { greater_than: 0.5 },
    error: {
      greater_than: 0.7,
      message:
        "Say what the rule does in one sentence, then show the rule. Move the rest to Calibration.",
    },
  },
};
```
