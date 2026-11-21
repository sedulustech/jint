import { has_title_without_context } from "jint:rules/seo";
import { rules as docs } from "./rules/docs.ts";
import { rules as opengraph } from "./rules/opengraph.ts";
import { rules as style } from "./rules/style.ts";

// The site's own rules, and the only place that says which files each reads. Each scope names the
// path from the repo root (the root config imports this file) and from web/ (a run started here).
const astro = ["web/src/**/*.astro", "src/**/*.astro"];
const css = ["web/src/**/*.css", "src/**/*.css"];
// Where each page's title and description are written: a static page's own .astro file, and a
// doc's front matter. The layouts and the docs route only hold placeholders that a page fills in.
const pages = ["web/src/pages/*.astro", "src/pages/*.astro", "docs/**/*.md"];
// the 404 page is not indexed, and the design docs are not published
const skipped = [
  "web/src/pages/404.astro",
  "src/pages/404.astro",
  "docs/designs/**",
  "../docs/designs/**",
];
const useCases = ["docs/use-cases/**/*.md", "docs/examples/**/*.md"];

export default {
  rules: {
    use: [
      // Open Graph: the page's title, description and social image, where each page writes them
      ...opengraph.map((rule) => ({ ...rule, include: pages, exclude: skipped })),
      // SEO: the title a searcher sees, in the pages that set one
      { ...has_title_without_context, include: pages, exclude: skipped },
      // style: the site's colors against its palette, in .astro <style> blocks and .css files
      ...style.map((rule) => ({ ...rule, include: [...astro, ...css] })),
      // docs: what a page says against what its front matter promises
      ...docs.map((rule) => {
        if (rule.name === "has_extra_content") return { ...rule, include: useCases };
        if (rule.name === "lacks_rule_link" || rule.name === "has_code_comment") {
          return { ...rule, include: ["docs/use-cases/**/*.md"] };
        }
        return { ...rule, include: ["docs/**/*.md"], exclude: ["docs/designs/**"] };
      }),
    ],
    exclude: ["**/dist/**", "**/node_modules/**"],
  },
};
