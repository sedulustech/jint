import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture, type CapturedElement } from "../../index.ts";

/**
 * One small document per shape markdown can take, and exactly what it captures.
 * markdown-shapes.test pins spans over one long file; here a failure names the shape. A row reads
 * `kind name < parent`, with the name only where the element has one; a shape that captures nothing
 * is an empty list.
 */
type Case = readonly [shape: string, source: string, expected: readonly string[]];

const HEADINGS: readonly Case[] = [
  [
    "a heading and its body",
    "# A\n\nx\n",
    ["h1.section A", "h1 A < h1.section", "paragraph < h1.section"],
  ],
  [
    "no blank line after a heading",
    "## B\nx\n",
    ["h2.section B", "h2 B < h2.section", "paragraph < h2.section"],
  ],
  [
    "closing hashes",
    "## B ##\n\nx\n",
    ["h2.section B", "h2 B < h2.section", "paragraph < h2.section"],
  ],
  [
    "a hash that is part of the title",
    "## C#\n\nx\n",
    ["h2.section C#", "h2 C# < h2.section", "paragraph < h2.section"],
  ],
  [
    "inline marks",
    "## `a` and *b*\n\nx\n",
    ["h2.section `a` and *b*", "h2 `a` and *b* < h2.section", "paragraph < h2.section"],
  ],
  ["an empty heading", "#\n\nx\n", ["h1.section", "h1 < h1.section", "paragraph < h1.section"]],
  // the two have one span, and both are elements
  ["a heading with nothing under it", "# A\n", ["h1.section A", "h1 A < h1.section"]],
  [
    "a heading with only a heading under it",
    "# A\n## B\n",
    ["h1.section A", "h1 A < h1.section", "h2.section B < h1.section", "h2 B < h2.section"],
  ],
  [
    "a skipped level",
    "# A\n\n### C\n",
    ["h1.section A", "h1 A < h1.section", "h3.section C < h1.section", "h3 C < h3.section"],
  ],
  [
    "the same title twice",
    "## A\n\nx\n\n## A\n\ny\n",
    [
      "h2.section A",
      "h2 A < h2.section",
      "paragraph < h2.section",
      "h2.section A",
      "h2 A < h2.section",
      "paragraph < h2.section",
    ],
  ],
  [
    "text before the first heading",
    "x\n\n# A\n",
    ["paragraph", "h1.section A", "h1 A < h1.section"],
  ],
  ["seven hashes", "####### A\n", ["paragraph"]],
  [
    "a heading in a quote",
    "> ## Q\n>\n> x\n",
    ["h2.section Q", "h2 Q < h2.section", "paragraph < h2.section"],
  ],
  [
    "a heading in a list",
    "- # L\n\n  x\n",
    [
      "list",
      "list_item < list",
      "h1.section L < list_item",
      "h1 L < h1.section",
      "paragraph < h1.section",
    ],
  ],
  // the parser makes no section for an underlined heading
  ["setext headings", "A\n=\n\nx\n\nB\n-\n", ["paragraph"]],
];

const CODE: readonly Case[] = [
  ["a fence", "```sh\nx\n```\n", ["code_block", "code < code_block"]],
  ["a fence with no language", "```\nx\n```\n", ["code_block", "code < code_block"]],
  ["a fence with attributes", '```ts title="a.ts"\nx\n```\n', ["code_block", "code < code_block"]],
  ["a tilde fence", "~~~js\nx\n~~~\n", ["code_block", "code < code_block"]],
  ["an empty fence", "```sh\n```\n", ["code_block"]],
  ["an unclosed fence", "```sh\nx\n# y\n", ["code_block", "code < code_block"]],
  ["a heading mark in a fence", "```sh\n# y\n```\n", ["code_block", "code < code_block"]],
  ["a fence in a fence", "````md\n```sh\nx\n```\n````\n", ["code_block", "code < code_block"]],
  [
    "a fence under a heading",
    "# A\n\n```sh\nx\n```\n",
    ["h1.section A", "h1 A < h1.section", "code_block < h1.section", "code < code_block"],
  ],
  [
    "a fence in a list",
    "- i\n\n  ```sh\n  x\n  ```\n",
    [
      "list",
      "list_item < list",
      "paragraph < list_item",
      "code_block < list_item",
      "code < code_block",
    ],
  ],
  ["a fence in a quote", "> ```sh\n> x\n> ```\n", ["code_block", "code < code_block"]],
  // an indented block has no fence around its text
  ["indented code", "x\n\n    y\n", ["paragraph", "code"]],
];

const PROSE: readonly Case[] = [
  ["a wrapped paragraph", "one\ntwo\n", ["paragraph"]],
  ["a quote", "> one\n> two\n", ["paragraph"]],
  ["an admonition", "> [!NOTE]\n> x\n", ["paragraph"]],
  ["an image", "![x](a.png)\n", ["paragraph"]],
  ["no final newline", "# A\n\nx", ["h1.section A", "h1 A < h1.section", "paragraph < h1.section"]],
  ["CRLF", "# A\r\n\r\nx\r\n", ["h1.section A", "h1 A < h1.section", "paragraph < h1.section"]],
  [
    "a list",
    "- a\n- b\n",
    [
      "list",
      "list_item < list",
      "paragraph < list_item",
      "list_item < list",
      "paragraph < list_item",
    ],
  ],
  [
    "a loose list",
    "- a\n\n- b\n",
    [
      "list",
      "list_item < list",
      "paragraph < list_item",
      "list_item < list",
      "paragraph < list_item",
    ],
  ],
  [
    "a task list",
    "- [ ] a\n- [x] b\n",
    [
      "list",
      "list_item < list",
      "paragraph < list_item",
      "list_item < list",
      "paragraph < list_item",
    ],
  ],
  [
    "a list in a list",
    "- a\n  - b\n",
    [
      "list",
      "list_item < list",
      "paragraph < list_item",
      "list < list_item",
      "list_item < list",
      "paragraph < list_item",
    ],
  ],
  [
    "two paragraphs in an item",
    "- a\n\n  b\n",
    ["list", "list_item < list", "paragraph < list_item", "paragraph < list_item"],
  ],
  // the two have one span, and both are elements
  ["a list of one entry", "- a\n", ["list", "list_item < list", "paragraph < list_item"]],
  ["a table", "| a |\n|---|\n| 1 |\n", ["table"]],
  [
    "YAML front matter",
    "---\na: 1\n---\n\nx\n",
    ["frontmatter", "pair a < frontmatter", "paragraph"],
  ],
];

const NOTHING: readonly Case[] = [
  ["an empty file", "", []],
  ["TOML front matter", "+++\na = 1\n+++\n", []],
  ["an HTML block", "<div>x</div>\n", []],
  ["an HTML comment", "<!-- c -->\n", []],
  ["a thematic break", "---\n", []],
  ["a link reference", "[ref]: http://a\n", []],
];

const dir = mkdtempSync(join(tmpdir(), "jint-markdown-cases-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function elementsOf(source: string): Promise<readonly CapturedElement[]> {
  const path = join(dir, `${crypto.randomUUID()}.md`);
  await Bun.write(path, source);
  return capture(path);
}

function rowOf(element: CapturedElement, all: readonly CapturedElement[]): string {
  const parent = all.find((e) => e.label === element.parent);
  const name = element.name === undefined ? "" : ` ${element.name}`;
  return element.kind + name + (parent === undefined ? "" : ` < ${parent.kind}`);
}

const textOf = (elements: readonly CapturedElement[], kind: string): string | undefined =>
  elements.find((e) => e.kind === kind)?.text;

describe("every markdown shape, and exactly what it captures", () => {
  for (const [shape, source, expected] of [...HEADINGS, ...CODE, ...PROSE, ...NOTHING]) {
    test(shape, async () => {
      const elements = await elementsOf(source);
      expect(elements.map((e) => rowOf(e, elements))).toEqual([...expected]);
      for (const element of elements) {
        const parent = elements.find((e) => e.label === element.parent);
        if (parent === undefined) continue;
        expect(element.span.startByte).toBeGreaterThanOrEqual(parent.span.startByte);
        expect(element.span.endByte).toBeLessThanOrEqual(parent.span.endByte);
      }
    });
  }
});

describe("an element's text", () => {
  test("code in a quote has no quote markers", async () => {
    const elements = await elementsOf("> ```sh\n> x\n> y\n> ```\n");
    expect(textOf(elements, "code")).toBe("x\ny\n");
    expect(textOf(elements, "code_block")).toBe("```sh\nx\ny\n```\n");
  });

  test("code in a list has no list indent, and keeps its own", async () => {
    const elements = await elementsOf("- i\n\n  ```sh\n  x\n    y\n  ```\n");
    expect(textOf(elements, "code")).toBe("x\n  y\n");
  });

  test("a quoted paragraph has no quote markers", async () => {
    expect(textOf(await elementsOf("> one\n> two\n"), "paragraph")).toBe("one\ntwo\n");
  });

  test("a section is its source as written, markers included", async () => {
    const source = "# A\n\n> one\n> two\n";
    expect(textOf(await elementsOf(source), "h1.section")).toBe(source);
  });

  test("outside a quote or a list, text is the span's slice", async () => {
    const source = "# A\n\nx\n\n```sh\n# y\n```\n";
    for (const e of await elementsOf(source))
      expect(e.text).toBe(source.slice(e.span.startByte, e.span.endByte));
  });
});
