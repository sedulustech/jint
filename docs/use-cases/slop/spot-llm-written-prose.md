---
title: "Spot LLM-written prose"
description: "A rule for prose files: it flags text that leans on the words language models overuse, so you can rewrite the sentence in plain words."
sidebar:
  label: LLM detection
---

# Spot LLM-written prose

`has_ai_vocabulary` flags a text that leans on the words language models overuse, such as "delve" and "tapestry", used in their stock sense.

```ts
// from "jint:rules/slop"
import type { RuleSchema } from "jint:sdk";

const has_ai_vocabulary: RuleSchema = {
  name: "has_ai_vocabulary",
  instructions:
    "Does the text lean on words that language models overuse, used in their stock figurative sense? Judge only the running prose of the text. Front matter, code blocks, tables and link lists are context and are never judged.",
  criteria: {
    true: "The text uses two or more words or phrases from the overused set in their stock sense, or one of them carries the whole sentence: delve, tapestry, testament, pivotal, crucial, underscore(s), showcasing, highlighting, fostering, landscape, realm, intricate, interplay, vibrant, seamless, robust, leverage, elevate, unlock, streamline, game-changer, navigate (figurative), resonate(s), multifaceted, dependable, meaningful, deliberate, profound, quietly, at its core, the real unlock, moves the needle.",
    false:
      "The text contains none of these words, or only one used literally or as ordinary domain jargon (a 'robust' estimator, a 'landscape' photo, 'leverage' in finance), or quotes them in order to mock AI writing. Plain everyday vocabulary, slang and technical terms are this side.",
  },
  target: "files",
  include: ["**/*.md"],
  handle: {
    warn: {
      greater_than: 0.5,
      message: "Replace the stock word with the plain one, or say what you mean.",
    },
  },
};
```
