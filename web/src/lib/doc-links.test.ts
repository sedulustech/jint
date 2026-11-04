import { describe, expect, test } from "bun:test";
import { docLink } from "./doc-links.ts";

describe("docLink", () => {
  test("a link to another doc becomes its page, keeping the fragment", () => {
    expect(docLink("config.md")).toBe("/docs/config/");
    expect(docLink("./config.md#scope")).toBe("/docs/config/#scope");
  });

  test("a use case links to its siblings and to the docs above it as it is written", () => {
    const from = "use-cases/react";
    expect(docLink("../../calibration.md", from)).toBe("/docs/calibration/");
    expect(docLink("./always-name-effects.md#why", from)).toBe(
      "/docs/use-cases/react/always-name-effects/#why",
    );
    expect(docLink("../../../GLOSSARY.md", from)).toBe(
      "https://github.com/sedulustech/jint/blob/feat/decisions-model/GLOSSARY.md",
    );
  });

  test("a doc under designs/ stays on GitHub, as does any nested doc the site does not render", () => {
    expect(docLink("designs/rule-domains.md")).toBe(
      "https://github.com/sedulustech/jint/blob/feat/decisions-model/docs/designs/rule-domains.md",
    );
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
