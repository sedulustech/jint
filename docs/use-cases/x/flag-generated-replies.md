---
title: "Flag generated replies"
description: "A rule for a post on X saved as one file with the post it answers: it flags a reply generic enough to sit under any post on its topic."
sidebar:
  label: Generated posts
---

# Flag generated replies

[`is_context_free_reply`](../../../packages/rules/x/src/index.ts) flags a reply that names nothing from the post it answers, read from one file per post with the reply under `## Post` and its parent under `## Parent post`.

```ts
import type { RuleSchema } from "jint:sdk";

const is_context_free_reply: RuleSchema = {
  name: "is_context_free_reply",
  instructions:
    "Is this reply so generic that it would fit under many unrelated posts on the same broad topic? Judge the text under '## Post' against the text under '## Parent post'; '## Metadata', '## Computed signals' and '## Author's other recent posts' are not judged here.",
  criteria: {
    true: "The '## Parent post' section has text, the post is at least about 12 words of commentary, insight or advice, and it could be pasted under a different post on the same broad topic without anyone noticing: it names no specific detail, person, number, screenshot, claim or wording from the parent, and engages only with the topic in general ('AI is changing everything', 'consistency really matters').",
    false:
      "The '## Parent post' section is missing, 'none' or 'unknown' (then answer No), or the post refers to something particular to the parent: a named detail, a quote, a number, a direct question about it, a disagreement with its specific claim, or an in-joke that only works there. Short reactions under about 12 words ('source?', 'lol', 'couldn't agree more', 'SO CUTE'), raw emotional reactions (all caps, '!!!', insults, fan gushing with typos) and jokes are this side even when generic.",
  },
  target: "files",
  handle: {
    warn: {
      greater_than: 0.5,
      message: "Refer to something in the post you answer.",
    },
  },
};
```
