import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { defineCollection } from "astro:content";

// The docs are the repo's own docs/ pages: one source, read here and on GitHub. Front matter is
// the contract - the site derives nothing from the body - so a doc missing a field fails the build.
const docs = defineCollection({
  loader: glob({
    pattern: ["*.md", "guides/*.md", "use-cases/**/*.md", "reference/*.md"],
    base: "../docs",
  }),
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
