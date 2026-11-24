import { is_meta_title_vague } from "jint:rules/seo";
import { is_description_complete } from "./opengraph.ts";
import type { ClassifyContext, CustomElement, CustomRule } from "jint:sdk";

const searchTitle = (frontMatter: CustomElement): string => {
  const title = frontMatter.element("yaml:pair", "title").value;
  if (title === undefined) throw new Error("the title is empty");
  return `${title} - jint docs`;
};

export const is_doc_title_vague: CustomRule = {
  ...is_meta_title_vague,
  target: "markdown:h1",
  state: (page: CustomElement, { file }: ClassifyContext) => ({
    metaTitle: searchTitle(file.element("markdown:frontmatter")),
    pageContent: page.source,
  }),
};

export const is_doc_description_complete: CustomRule = {
  name: "is_doc_description_complete",
  target: "markdown:h1",
  state: (_page, { file }) => {
    const frontMatter = file.element("markdown:frontmatter");
    return {
      metaTitle: searchTitle(frontMatter),
      metaDescription: frontMatter.element("yaml:pair", "description").value,
    };
  },
  instructions: is_description_complete.instructions,
  criteria: {
    true: "The description says what the page is and what the reader gets from it, in a full sentence.",
    false: is_description_complete.criteria.false,
  },
  handle: is_description_complete.handle,
};
