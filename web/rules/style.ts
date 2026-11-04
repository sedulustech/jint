/**
 * Style rules: the site's CSS against its palette. Site-local, not an official domain, and
 * calibrated on this repo's site only. Each rule reads one source file whole (the `<style>` blocks
 * of an .astro file, or a .css file) and is a defect question: a high reading is bad.
 */

import type { NoulRuleSchema, RuleSchema } from "@jint/contract";

export const has_off_palette_color: NoulRuleSchema = {
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

/** Every rule of this set. */
export const rules: readonly RuleSchema[] = [has_off_palette_color];
