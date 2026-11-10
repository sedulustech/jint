---
title: "Name the page in its title"
description: "A rule for page files: it flags a page whose title is only the product name and a category, so a reader of a shared link cannot tell what the page is."
sidebar:
  label: Name the page in its title
---

# Name the page in its title

`is_title_informative` flags a page whose title is only the product name and a category, with nothing that says what the page is about.

```ts
import type { RuleSchema } from "jint:sdk";

const is_title_informative: RuleSchema = {
  name: "is_title_informative",
  instructions:
    "Informative means a reader who sees only the title, as a search result or a browser tab, can tell what the page is about. Judge the title alone, not the description. Does the page's title name the page's subject or what the reader gets, in words beyond the product name and a category?",
  criteria: {
    true: "This file sets no page title, description or social image, so there is nothing to judge. Otherwise the title names the page's subject or the reader's gain, so a reader tells this page from the product's others.",
    false:
      "The title is the product name with a category or a generic word (a brand and a label), and says nothing about what this page offers.",
  },
  target: "files",
  include: ["**/*.astro", "**/*.html"],
  handle: { warn: { less_than: 0.6, message: "Put what this page is about in the title." } },
};
```
