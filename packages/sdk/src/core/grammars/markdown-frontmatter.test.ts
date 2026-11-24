import { describe, expect, test } from "bun:test";
import { capture } from "../../index.ts";
import { captureShapes, shapesSuite, type Absence, type Row } from "./shapes-suite.ts";

const FIXTURE = new URL("./markdown-frontmatter.md", import.meta.url).pathname;

describe("markdown frontmatter", () => {
  test("the fenced block is one element: the fences and the keys, nothing after", async () => {
    const elements = await capture(FIXTURE);
    const front = elements.filter((e) => e.kind === "frontmatter");
    expect(front).toHaveLength(1);
    expect([front[0]!.span.start.line, front[0]!.span.end.line]).toEqual([1, 5]);
    expect(front[0]!.text.startsWith("---\ntitle: Install")).toBe(true);
    expect(front[0]!.text).not.toContain("# Install");
  });

  test("the body still captures its own elements", async () => {
    const kinds = (await capture(FIXTURE)).map((e) => e.kind);
    expect(kinds).toContain("h1");
    expect(kinds).toContain("paragraph");
  });
});

// markdown-shapes.md cannot hold the frontmatter capture (the block must open the file, which would
// shift every span there), so this fixture pins that capture's row in the same inventory form the
// completeness guard (shapes-coverage.test.ts) reads.
const INVENTORY: readonly Row[] = [
  // the fenced block is one element, closing fence included, ending where the next row starts
  { id: "front", kind: "frontmatter", start: [1, 0], end: [5, 0] },
  { kind: "pair", start: [2, 0], end: [2, 14], name: "title", parent: "front" },
  { kind: "pair", start: [3, 0], end: [3, 41], name: "description", parent: "front" },
  { id: "install", kind: "h1.section", start: [6, 0], end: [9, 0], name: "Install" },
  { kind: "h1", start: [6, 0], end: [7, 0], name: "Install", parent: "install" },
  { kind: "paragraph", start: [8, 0], end: [9, 0], parent: "install" },
];

const ABSENCES: readonly Absence[] = [
  { line: 4, why: "the closing fence is part of the one frontmatter element" },
];

shapesSuite(
  "markdown frontmatter",
  "markdown-frontmatter.md",
  INVENTORY,
  ABSENCES,
  await captureShapes("markdown-frontmatter.md"),
);
