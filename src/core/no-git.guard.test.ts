import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// The pinned contract (diff-target, settled twice): jint NEVER shells out and never parses a
// VCS. This guard fails the suite the moment a child_process import (or a git invocation)
// appears anywhere under src/ — the whole class of anchor bugs the --since form had dies here.

describe("no-git guard — jint never shells out", () => {
  test("no module under src/ imports child_process or spawns git", async () => {
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(p);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          const text = await readFile(p, "utf8");
          if (/child_process|execFile|spawnSync|\bexec\(/.test(text)) offenders.push(p);
        }
      }
    }
    await walk("src");
    expect(offenders).toEqual([]);
  });
});
