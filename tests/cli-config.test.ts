import { describe, test, jest, expect } from "bun:test";
import { runCli, NO_KEY_WIRE } from "./helpers/cli.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";

// every test here spawns CLI processes: the per-test timeout matches the spawn ceiling
// (60s), so the framework clock cannot undercut a healthy run on a slow runner
jest.setTimeout(60_000);

// CONFIG_INVALID exits 2 through the real CLI (moved here from the sdk's load.test.ts when
// @jint/sdk was split out: sdk unit tests must not spawn the cli).
describe("cli: config load errors exit 2", () => {
  test("loads jint.config.json from the current dir", async () => {
    const tmpDir = scratchDir("jint-config-test");
    Bun.write(tmpDir + "/jint.config.json", JSON.stringify({ input: ".", exclude: [] }));

    // Should exit 2 (CONFIG_INVALID) because key is empty: fail fast, nothing walked
    Bun.write(tmpDir + "/input.ts", "// content");
    const proc = await runCli(["run", "input.ts", "--json"], {
      cwd: tmpDir,
      env: NO_KEY_WIRE,
    });
    expect(proc.code).toBe(2);
    rmScratchTree(tmpDir);
  });

  test("broken JSON -> CONFIG_INVALID, exit 2", async () => {
    const tmpDir = scratchDir("jint-config-broken");
    Bun.write(tmpDir + "/jint.config.json", "{ broken: true }");

    const proc = await runCli(["run", "--json"], { cwd: tmpDir, env: NO_KEY_WIRE });
    expect(proc.code).toBe(2);
    rmScratchTree(tmpDir);
  });
});

describe("cli: --dry-run prints the rules that would run, without classifying", () => {
  test("two-rule config: block on stdout, empty stderr, exit 0, no requests dir", async () => {
    const tmpDir = scratchDir("jint-dryrun");
    Bun.write(
      tmpDir + "/jint.config.json",
      JSON.stringify({ rules: ["is_function_srp", "will_comment_drift"], exclude: [] }),
    );

    const proc = await runCli(["run", "--dry-run"], { cwd: tmpDir, env: NO_KEY_WIRE });
    expect(proc.code).toBe(0);
    expect(proc.stderr).toBe("");
    const err = proc.stdout;
    expect(err).toContain("jint: measuring with 2 rules");
    expect(err).toContain("is_function_srp  [functions]");
    expect(err).toContain("will_comment_drift  [comments]");
    expect(err).toContain("asks: "); // full criteria prose, not just names
    expect(err).not.toContain("is_greppable"); // third rule never declared, never printed
    expect(
      Bun.spawnSync(["bash", "-c", "test ! -e tmp/requests && echo none"], { cwd: tmpDir })
        .stdout.toString()
        .trim(),
    ).toBe("none");
    rmScratchTree(tmpDir);
  });

  test("--disable narrows the printed set to the effective rules", async () => {
    const tmpDir = scratchDir("jint-dryrun-disable");
    Bun.write(
      tmpDir + "/jint.config.json",
      JSON.stringify({ rules: ["is_function_srp", "will_comment_drift"], exclude: [] }),
    );

    const proc = await runCli(["run", "--dry-run", "--disable", "is_function_srp"], {
      cwd: tmpDir,
      env: NO_KEY_WIRE,
    });
    expect(proc.code).toBe(0);
    const err = proc.stdout;
    expect(err).toContain("jint: measuring with 1 rule");
    expect(err).toContain("will_comment_drift");
    expect(err).not.toContain("is_function_srp");
    rmScratchTree(tmpDir);
  });

  test("--dry-run --json composes: one JSON document on stdout, banner on stderr", async () => {
    const tmpDir = scratchDir("jint-dryrun-json");
    Bun.write(
      tmpDir + "/jint.config.json",
      JSON.stringify({ rules: ["is_function_srp"], exclude: [] }),
    );

    const proc = await runCli(["run", "--dry-run", "--json"], {
      cwd: tmpDir,
      env: NO_KEY_WIRE,
    });
    expect(proc.code).toBe(0);
    // byte-clean stdout: exactly one JSON document (the declared rule set), banner on stderr
    const doc = JSON.parse(proc.stdout) as { rules: { name: string }[]; customRules: number };
    expect(doc.rules.map((r) => r.name)).toEqual(["is_function_srp"]);
    expect(proc.stderr).toContain("jint: measuring with 1 rule");
    expect(proc.stdout).not.toContain("jint:");
    rmScratchTree(tmpDir);
  });

  test("config resolving to zero rules: CONFIG_NO_RULES, exit 2", async () => {
    const tmpDir = scratchDir("jint-dryrun-empty");
    Bun.write(tmpDir + "/jint.config.json", JSON.stringify({ rules: [], exclude: [] }));

    const proc = await runCli(["run", "--dry-run"], { cwd: tmpDir, env: NO_KEY_WIRE });
    expect(proc.code).toBe(2);
    expect(proc.stderr).toContain("CONFIG_NO_RULES");
    rmScratchTree(tmpDir);
  });
});
