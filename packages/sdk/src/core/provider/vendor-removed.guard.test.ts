import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The vendor classifier (its provider, SDK, key variable and wire format) is gone: jint asks its
// questions through the Decisions adapters only. This guard fails the suite when its name comes
// back in any tracked file - code, config, lockfile, generated docs or skills. The allowlist is
// the places where the past is the point: calibration records, the reader of legacy recordings
// (and the recordings it reads), and this file.

const ROOT = join(import.meta.dir, "../../../../..");

const VENDOR = /typesafe|systemone|system one/i;

const ALLOWED: string[] = [
  "docs/calibration/", // historical calibration records
  "packages/sdk/src/ui/request-file.ts", // the legacy-shape reader
  "packages/sdk/src/ui/request-file.test.ts", // its tests
  "packages/app/tests/fixtures/", // recorded runs, legacy shape included
  "packages/sdk/src/core/provider/vendor-removed.guard.test.ts", // this guard
];

const allowed = (path: string): boolean => ALLOWED.some((a) => path === a || path.startsWith(a));

describe("vendor-removed guard", () => {
  test("no tracked file outside the allowlist names the removed vendor", () => {
    const listed = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: ROOT });
    expect(listed.exitCode).toBe(0);
    const files = new TextDecoder().decode(listed.stdout).split("\0").filter(Boolean);
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const file of files) {
      if (allowed(file)) continue;
      let text: string;
      try {
        text = readFileSync(join(ROOT, file), "utf8");
      } catch {
        continue; // deleted in the working tree, or a directory entry (submodule)
      }
      if (VENDOR.test(text) || VENDOR.test(file)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("the allowlist names only paths that exist", () => {
    for (const path of ALLOWED) expect(existsSync(join(ROOT, path)), path).toBe(true);
  });
});
