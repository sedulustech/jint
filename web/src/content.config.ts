import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { defineCollection } from "astro:content";

// The docs are the repo's own docs/*.md: one source, read here and on GitHub. Front matter is
// the contract - the site derives nothing from the body - so a doc missing a field fails the build:
//
//   title: the page title (<title>, og:title, llms.txt)
//   description: the meta description
//   sidebar:
//     label: the sidebar entry (defaults to title)
//
// The order of the sidebar is not front matter: web/sidebar.json lists every doc id in reading order.
const docs = defineCollection({
  // the top-level docs and the use cases (docs/use-cases/<technology>/<name>.md); docs/designs is not site content
  loader: glob({ pattern: ["*.md", "use-cases/**/*.md"], base: "../docs" }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1).max(200),
    sidebar: z
      .object({
        label: z.string().min(1).optional(),
      })
      .strict()
      .default({}),
  }),
});

export const collections = { docs };
