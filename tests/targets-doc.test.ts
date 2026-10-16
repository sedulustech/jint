import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// docs/targets.md is GENERATED (scripts/generate-schema.ts): one row per member of the target
// vocabulary, columns read from the live resolution and each grammar's queries.scm census. This
// test is the drift guard: regenerate and require byte-identical output. A new target without a
// row (or a hand-edited row) fails here.
describe("docs/targets.md freshness", () => {
  test("regenerating the table leaves the committed file byte-identical", () => {
    const file = "docs/targets.md";
    const before = readFileSync(file, "utf8");
    const run = spawnSync("bun", ["scripts/generate-schema.ts"], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("one row per target, no more, no fewer (6 vocabulary members)", () => {
    const doc = readFileSync("docs/targets.md", "utf8");
    const targets = ["files", "functions", "definitions", "comments", "loose-comments", "imports"];
    for (const target of targets) {
      expect(doc).toContain("| `" + target + "`");
    }
    const rows = doc.split("\n").filter((l) => l.startsWith("| `"));
    expect(rows).toHaveLength(targets.length);
  });
});
