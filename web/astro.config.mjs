import { satteri } from "@astrojs/markdown-satteri";
// @ts-check
import { defineConfig } from "astro/config";
import { docLinksPlugin } from "./src/lib/doc-links.ts";

export default defineConfig({
  // the canonical origin: previews and local builds also canonicalize to it, never to themselves
  site: "https://jint.sh",
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  markdown: {
    processor: satteri({ mdastPlugins: [docLinksPlugin] }),
    // both palettes ship as CSS variables (--shiki-light / --shiki-dark); the page theme picks one
    shikiConfig: { themes: { light: "github-light", dark: "github-dark" }, defaultColor: false },
  },
});
