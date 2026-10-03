import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// The pinned contract (diff-target, settled twice): jint NEVER shells out and never parses a
// VCS. This guard fails the suite the moment any shell-out capability appears under src/ —
// child_process/node:child_process imports, Bun.spawn/Bun.spawnSync, execFile, exec — the
// whole class of anchor bugs the --since form had dies here.

const FORBIDDEN: RegExp[] = [
  /child_process/, // bare and node:-prefixed imports
  /execFile/,
  /spawnSync/,
  /Bun\.spawn/,
  /\bexec\s*\(/,
];

describe("no-git guard — jint never shells out", () => {
  test("no module under src/ touches a process boundary", async () => {
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(p);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          const text = await readFile(p, "utf8");
          if (FORBIDDEN.some((rx) => rx.test(text))) offenders.push(p);
        }
      }
    }
    // guard both runtime packages: the sdk (spawn-free by wall W2) and the cli (spawn-free by
    // contract — parse argv, call sdk, render; process boundaries live in api/server, not here)
    for (const dir of ["packages/sdk/src", "packages/cli/src"]) await walk(dir);
    expect(offenders).toEqual([]);
  });
});
