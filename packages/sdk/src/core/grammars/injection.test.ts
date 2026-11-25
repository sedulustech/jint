import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

const elementsOf = async (source: string, language = "markdown") => {
  const { definitions, comments } = await decompose(source, language);
  return [...definitions, ...comments];
};
const pairsOf = async (source: string, language = "markdown") =>
  (await elementsOf(source, language)).filter((e) => e.capture === "pair");

describe("injection", () => {
  test("front matter holds yaml's pairs, at their place in the file", async () => {
    const source = '---\ntitle: "É a"\ntags: [x]\nsidebar:\n  label: B\n---\n\n# H\n';
    const elements = await elementsOf(source);
    const host = elements.find((e) => e.capture === "frontmatter")!;
    const pairs = elements.filter((e) => e.capture === "pair");
    expect(pairs.map((p) => [p.key, p.grammar])).toEqual([
      ["title", "yaml"],
      ["tags", "yaml"],
      ["sidebar", "yaml"],
      ["label", "yaml"],
    ]);
    for (const p of pairs) {
      expect(source.slice(p.span.startByte, p.span.endByte)).toBe(p.content);
    }
    expect(pairs[3]!.span.start).toEqual({ line: 5, column: 2 });
    expect(pairs.slice(0, 3).every((p) => p.parent === host.label)).toBe(true);
    expect(pairs[3]!.parent).toBe(pairs[2]!.label);
    expect(new Set(elements.map((e) => e.label)).size).toBe(elements.length);
  });

  test("a value leaves out its quotes, and a key with none has no value", async () => {
    const pairs = await pairsOf("---\na: \"x 'y'\"\nb: 'z'\n\"c\": w\nd:\ne: f: g\n---\n\n# H\n");
    expect(pairs.slice(0, 4).map((p) => [p.key, p.value])).toEqual([
      ["a", "x 'y'"],
      ["b", "z"],
      ["c", "w"],
      ["d", undefined],
    ]);
  });

  test("a rule on the page past the front matter is not yaml", async () => {
    expect(await pairsOf("# H\n\n---\n\na: b\n\n---\n")).toEqual([]);
  });

  test("a comment in front matter is yaml's, and no pair owns it", async () => {
    const elements = await elementsOf("---\na: b\n# why\nc:\n  # inner\n  d: e\n---\n\n# H\n");
    const comments = elements.filter((e) => e.capture === "comment");
    expect(comments.map((c) => [c.content, c.docstringOf])).toEqual([
      ["# why", undefined],
      ["# inner", undefined],
    ]);
    expect(elements.filter((e) => e.internalCommentCount > 0 || e.attachedComment)).toEqual([]);
  });

  test("a language with no grammar, and one already open around it, fail", async () => {
    const injecting = (language: string) =>
      decompose("# H\n", "markdown", {
        queries: `(section) @s (#set! "capture.s.definition" "true") (#set! "capture.s.injection" "${language}")\n`,
      });
    expect(injecting("cobol")).rejects.toThrow("cobol");
    expect(injecting("markdown")).rejects.toThrow("already being parsed around it (markdown)");
  });
});

test("a yaml file's pairs own no comment", async () => {
  const elements = await elementsOf("# file\n\n# above\na:\n  # in\n  b: c\n", "yaml");
  expect(elements.filter((e) => e.capture === "pair").map((p) => p.key)).toEqual(["a", "b"]);
  expect(elements.filter((e) => e.internalCommentCount > 0 || e.attachedComment)).toEqual([]);
});
