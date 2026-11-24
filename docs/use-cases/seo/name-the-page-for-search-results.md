---
title: "Name the page for search results"
description: "A rule that compares the title a search result shows with the page's text, so you can fix a title that is vague or names another subject."
sidebar:
  label: SEO
---

# Name the page for search results

[`is_meta_title_vague`](../../../packages/rules/seo/src/index.ts) flags a page whose search title is vague or names another subject than the page's text.

```ts
import { defineConfig, type CustomRule } from "jint:sdk";

const is_meta_title_vague: CustomRule = {
  name: "is_meta_title_vague",
  instructions:
    "metaTitle is the title a search result shows for the page in pageContent. Does metaTitle fail to describe pageContent?",
  criteria: {
    true: 'metaTitle is vague or inaccurate. Vague: a label such as "Home", "Profile" or "Overview" that would fit many pages and does not say which subject or task of pageContent this page covers. Inaccurate: it names a subject that is not the main subject of pageContent.',
    false:
      "metaTitle is descriptive, concise and accurate. It names the main subject of pageContent, or the task a reader completes with it, in specific words, so a searcher can tell this page from the site's other pages. A short title is fine when its words are specific.",
  },
  handle: {
    warn: { greater_than: 0.5 },
    error: {
      greater_than: 0.7,
      message: "Rewrite the title to name the page's main subject, or the task a reader completes.",
    },
  },
  target: "files",
  state: (file) => ({
    metaTitle:
      file.getElement("markdown:frontmatter").getElement("yaml:pair", "title").value +
      " - jint docs",
    pageContent: file.getElement("markdown:h1.section").source,
  }),
};

export default defineConfig({ rules: { include: ["docs/**/*.md"], use: [is_meta_title_vague] } });
```
