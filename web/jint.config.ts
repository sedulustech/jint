import { has_title_without_context } from "jint:rules/seo";
import { rules as docs } from "./rules/docs.ts";
import { rules as opengraph } from "./rules/opengraph.ts";
import { rules as style } from "./rules/style.ts";

// The site's own rules, and the only place that says which files each reads. Each scope names the
// path from the repo root (the root config imports this file) and from web/ (a run started here).
const astro = ["web/src/**/*.astro", "src/**/*.astro"];
const css = ["web/src/**/*.css", "src/**/*.css"];
const pages = ["web/src/pages/**/*.astro", "src/pages/**/*.astro"];
const useCases = ["docs/use-cases/**/*.md", "docs/examples/**/*.md"];

export default {
  rules: {
    use: [
      // Open Graph: the page's title, description and social image, in the pages that set them
      ...opengraph.map((rule) => ({ ...rule, include: astro })),
      // SEO: the title a searcher sees, in the pages that set one
      { ...has_title_without_context, include: pages },
      // style: the site's colors against its palette, in .astro <style> blocks and .css files
      ...style.map((rule) => ({ ...rule, include: [...astro, ...css] })),
      // docs: what a page says against what its front matter promises
      ...docs.map((rule) =>
        rule.name === "has_extra_content"
          ? { ...rule, include: useCases }
          : { ...rule, include: ["docs/**/*.md"], exclude: ["docs/designs/**"] },
      ),
    ],
    exclude: ["**/dist/**", "**/node_modules/**"],
  },
};
