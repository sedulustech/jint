import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { capture } from "./capture.ts";
import { resetGrammarsForTest } from "./grammars.ts";
import { resetQueriesForTest } from "./query.ts";

afterEach(() => {
  resetGrammarsForTest();
  resetQueriesForTest();
});

describe("dbg2", () => {
  test("shadow only", async () => {
    const dir = "/tmp/jint-capture-dbg2";
    const fs = await import("node:fs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, "doc.md"), "# Head\n\nprose body\n");
    const shadow = join(import.meta.dir, "../../../../../tests/fixtures/grammars", "markdown");
    const elements = await capture(join(dir, "doc.md"), undefined, shadow);
    console.log(JSON.stringify(elements.map((e) => ({ kind: e.kind, line: e.span.start.line }))));
    expect(true).toBe(true);
  });
});
