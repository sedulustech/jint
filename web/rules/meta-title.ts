import { docsTitle } from "../src/lib/title.ts";
import type { ComposeState, CustomElement } from "jint:sdk";

/** The docs the site publishes; the designs are not indexed. */
const PUBLISHED = /^docs\/(?!designs\/).*\.md$/;

/** One element per doc: its front matter, or its first element, so a doc without front matter fails. */
export function docPages(elements: readonly CustomElement[]): CustomElement[] {
  const docs = Map.groupBy(
    elements.filter((e) => PUBLISHED.test(e.path)),
    (e) => e.path,
  );
  return [...docs.values()].map((doc) => doc.find((e) => e.capture === "frontmatter") ?? doc[0]!);
}

export const metaTitleState: ComposeState = (page, { file }) => {
  if (page.capture !== "frontmatter") throw new Error("the page has no front matter");
  const title = page.source.match(/^title:\s*(.+?)\s*$/m)?.[1]?.replace(/^"(.*)"$/, "$1");
  if (title === undefined) throw new Error("the front matter has no title");
  const pageContent = file.source.slice(page.span.endByte).trim();
  if (pageContent === "") throw new Error("the page has no text");
  return { metaTitle: docsTitle(title), pageContent };
};
