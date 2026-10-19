/**
 * The machine parity gate: runs scripts/parity.ts --assert for all nine languages against the
 * previous implementation (the embed-all worktree, run live). The harness prints the diff and fails
 * on any delta that is not in the language's committed allowlist
 * (tests/fixtures/parity/<lang>/deltas.txt), so the verdict files are re-checked by the suite
 * instead of aging into prose.
 *
 * It SKIPS when the reference worktree is absent (CI without the sibling checkout): the corpora,
 * the pins in extraction-counts.test.ts, and the committed deltas still hold there.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const REFERENCE = process.env.EMBED_DIR ?? join(ROOT, "..", "embed-all");
const LANGUAGES = ["typescript", "tsx", "python", "go", "css", "markdown", "c", "cpp", "php"];

const available = existsSync(join(REFERENCE, "packages/sdk/src/core/input/walk.ts"));

describe.if(available)("parity gate - every delta is documented", () => {
  test("all nine languages match their committed delta allowlists", async () => {
    const proc = Bun.spawnSync({
      cmd: ["bun", "scripts/parity.ts", ...LANGUAGES, "--assert"],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = proc.stdout.toString() + proc.stderr.toString();
    expect(output, output).toContain("all documented");
    expect(proc.exitCode, output).toBe(0);
  }, 120_000);
});
