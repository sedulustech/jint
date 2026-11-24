import { is_meta_title_vague } from "jint:rules/seo";
import { is_description_complete } from "./opengraph.ts";
import type { CustomElement, CustomRule } from "jint:sdk";

const searchTitle = (frontMatter: CustomElement): string => {
  const title = frontMatter.getElement("yaml:pair", "title").value;
  if (title === undefined) throw new Error("the title is empty");
  return `${title} - jint docs`;
};

export const is_doc_title_vague: CustomRule = {
  ...is_meta_title_vague,
  target: "files",
  state: (file: CustomElement) => ({
    metaTitle: searchTitle(file.getElement("markdown:frontmatter")),
    pageContent: file.getElement("markdown:h1.section").source,
  }),
};

export const is_doc_description_complete: CustomRule = {
  name: "is_doc_description_complete",
  target: "files",
  state: (file) => {
    const frontMatter = file.getElement("markdown:frontmatter");
    return {
      metaTitle: searchTitle(frontMatter),
      metaDescription: frontMatter.getElement("yaml:pair", "description").value,
    };
  },
  instructions: is_description_complete.instructions,
  criteria: {
    true: "The description says what the page is and what the reader gets from it, in a full sentence.",
    false: is_description_complete.criteria.false,
  },
  handle: is_description_complete.handle,
};
