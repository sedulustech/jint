import { satteri } from "@astrojs/markdown-satteri";
// @ts-check
import { defineConfig } from "astro/config";
import { CODE_HIGHLIGHT } from "./src/lib/consts.ts";
import { docLinksPlugin } from "./src/lib/doc-links.ts";
import { figuresPlugin } from "./src/lib/figures.ts";

export default defineConfig({
  // the canonical origin: previews and local builds also canonicalize to it, never to themselves
  site: "https://jint.sh",
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  markdown: {
    processor: satteri({ mdastPlugins: [docLinksPlugin, figuresPlugin] }),
    shikiConfig: CODE_HIGHLIGHT,
  },
});
