import { describe, expect, test } from "bun:test";
import { docPages, metaTitleState } from "./meta-title.ts";
import type { ClassifyContext, CustomElement } from "jint:sdk";

const FRONT = '---\ntitle: "Run a local model"\ndescription: d\n---\n';

const element = (capture: string, path: string, source = ""): CustomElement =>
  ({ capture, path, source, span: { endByte: source.length } }) as CustomElement;

const stateOf = (page: CustomElement, text: string) =>
  metaTitleState(page, { file: { source: text } } as ClassifyContext);

describe("docPages", () => {
  test("a doc is its front matter, or its first element without one", () => {
    const front = element("frontmatter", "docs/a.md", FRONT);
    const heading = element("h1", "docs/b.md");
    const picked = docPages([front, element("h1", "docs/a.md"), heading]);
    expect(picked).toEqual([front, heading]);
  });

  test("only the published docs are pages", () => {
    const paths = ["GLOSSARY.md", "docs/designs/a.md", "packages/a/docs/b.md", "docs/a.ts"];
    expect(docPages(paths.map((path) => element("h1", path)))).toEqual([]);
  });
});

describe("metaTitleState", () => {
  const page = element("frontmatter", "docs/a.md", FRONT);

  test("the title a search result shows, and the text under the front matter", () => {
    expect(stateOf(page, FRONT + "\n# A\n\nx\n")).toEqual({
      metaTitle: "Run a local model - jint docs",
      pageContent: "# A\n\nx",
    });
  });

  test("a part it cannot capture throws", () => {
    expect(() => stateOf(element("h1", "docs/a.md"), "# A\n")).toThrow("no front matter");
    expect(() => stateOf(element("frontmatter", "docs/a.md", "---\nname: a\n---\n"), "x")).toThrow(
      "no title",
    );
    expect(() => stateOf(page, FRONT)).toThrow("no text");
  });
});
