---
title: "Name the page for search results"
description: "A rule for built HTML pages: it flags a page whose title tag is a bare label, so a searcher cannot tell from the results list what the page is."
sidebar:
  label: SEO
---

# Name the page for search results

`has_title_without_context` flags a built page whose title tag is a bare label, such as one noun, so a searcher reading a list of results cannot tell what the page is about.

```ts
import type { RuleSchema } from "jint:sdk";

const has_title_without_context: RuleSchema = {
  name: "has_title_without_context",
  instructions:
    "A title has context when a searcher who sees only the page's title tag in a list of search results can tell what the page is about and what to expect from it. Does this page's title tag lack context: it is a bare label or fragment that tells a searcher nothing about the subject or what the page does?",
  criteria: {
    true: "The title tag is a bare label: a noun, a verb with no object, or an adjective alone, naming an area or a feature, with no object the verb acts on and no question. The site's name beside a bare label does not give it context, and neither does the rest of the page.",
    false:
      "The title tag is an action on a named object, a question, or a phrase that names its subject in words a searcher outside the product would use: it says what the page is about or what the reader can do.",
  },
  target: "files",
  include: ["**/*.html"],
  handle: {
    warn: {
      greater_than: 0.5,
      message: "Rewrite the title to name the subject or what the reader can do.",
    },
  },
};
```
