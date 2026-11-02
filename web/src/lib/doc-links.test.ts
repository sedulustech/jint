import { describe, expect, test } from "bun:test";
import { docLink } from "./doc-links.ts";

describe("docLink", () => {
  test("a link to another doc becomes its page, keeping the fragment", () => {
    expect(docLink("rules.md")).toBe("/docs/rules/");
    expect(docLink("./config.md#scope")).toBe("/docs/config/#scope");
  });

  test("a link to a repo file outside docs/ points at it on GitHub", () => {
    expect(docLink("../GLOSSARY.md")).toBe(
      "https://github.com/sedulustech/jint/blob/feat/decisions-model/GLOSSARY.md",
    );
    expect(docLink("../README.md#how-to-use")).toBe(
      "https://github.com/sedulustech/jint/blob/feat/decisions-model/README.md#how-to-use",
    );
    expect(docLink("../jint.schema.json")).toBe(
      "https://github.com/sedulustech/jint/blob/feat/decisions-model/jint.schema.json",
    );
  });

  test("a non-markdown file inside docs/ points at it on GitHub, not at a page", () => {
    expect(docLink("calibration/v5.request.json")).toBe(
      "https://github.com/sedulustech/jint/blob/feat/decisions-model/docs/calibration/v5.request.json",
    );
  });

  test("absolute links, root paths, anchors and mail links pass through", () => {
    for (const url of ["https://example.com/a.md", "/docs/x/", "#top", "mailto:a@b.c"]) {
      expect(docLink(url)).toBe(url);
    }
  });
});
