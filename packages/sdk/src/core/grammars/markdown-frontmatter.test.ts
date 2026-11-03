import { describe, expect, test } from "bun:test";
import { capture } from "../../index.ts";

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
    expect(kinds).toContain("section");
    expect(kinds).toContain("paragraph");
  });
});
