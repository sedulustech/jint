---
title: "Use case: use palette colors"
description: "A rule that reviews this site's own styles: every color comes from a palette token, never a literal."
sidebar:
  label: Use palette colors
---

# Use case: use palette colors

`has_off_palette_color` flags a style rule that sets a color from a literal instead of a palette token.

```ts
import type { RuleSchema } from "jint:sdk";

const has_off_palette_color: RuleSchema = {
  name: "has_off_palette_color",
  target: "files",
  include: ["**/*.astro", "**/*.css"],
  instructions:
    "Does a style rule in this file set a color from a literal value (a hex code, rgb(), hsl(), or a color name) instead of from one of the palette tokens var(--bg), var(--fg), var(--muted), var(--rule) and var(--code-bg)? The block that declares the palette tokens themselves is not a style rule.",
  criteria: {
    true: "A style rule sets color, background, border, fill, stroke or a shadow from a literal color value such as #333, rgb(0 0 0 / 0.5) or red. The keywords currentColor and transparent are not literal colors.",
    false:
      "Every color in a style rule comes from a palette token, currentColor or transparent, or the file only declares the palette tokens.",
  },
  handle: {
    warn: { greater_than: 0.5 },
    error: {
      greater_than: 0.7,
      message: "Use a palette token (--bg, --fg, --muted, --rule, --code-bg), not a literal color.",
    },
  },
};
```
