import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateConfig } from "../../config/load.ts";
import { captureFor } from "./capture.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function project(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "jint-coverage-"));
  roots.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

async function notesOf(dir: string, queries?: string): Promise<string[]> {
  const notes: string[] = [];
  const config = validateConfig({}, "jint.config.json", undefined, undefined, true);
  await captureFor(config, { onNote: (note) => notes.push(note) })(dir, queries);
  return notes;
}

describe("what a capture missed", () => {
  test("a file with no element names the nodes it holds", async () => {
    const dir = project({ "a.md": "<div>x</div>\n\n---\n" });
    expect(await notesOf(dir)).toEqual([
      "a.md: 0 elements captured (2 nodes not captured: html_block, thematic_break)",
    ]);
  });

  test("files that miss the same nodes share a line", async () => {
    const dir = project({ "a.md": "<div>x</div>\n", "b.md": "<p>y</p>\n" });
    expect(await notesOf(dir)).toEqual([
      "2 files: 0 elements captured (1 node not captured: html_block): a.md, b.md",
    ]);
  });

  test("a file with elements says nothing", async () => {
    expect(await notesOf(project({ "a.md": "# A\n\nx\n" }))).toEqual([]);
  });

  test("a capture of the caller's queries that matched nothing names its line", async () => {
    const dir = project({ "a.md": "# A\n\nx\n", "b.md": "y\n" });
    const queries = join(
      project({
        "my.scm":
          '(paragraph) @prose (#set! "capture.prose.definition" "true")\n\n(html_block) @html (#set! "capture.html.definition" "true")\n',
      }),
      "my.scm",
    );
    expect(await notesOf(dir, queries)).toEqual([`${queries}:3 @html matched nothing in 2 files`]);
  });
});
