import { describe, expect } from "bun:test";
import { runCli, slowTest } from "./helpers/cli.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";

// CONFIG_INVALID exits 2 through the real CLI (moved here from the sdk's load.test.ts when
// @jint/sdk was split out: sdk unit tests must not spawn the cli).
describe("cli: config load errors exit 2", () => {
  slowTest("loads jint.config.json from the current dir", async () => {
    const tmpDir = scratchDir("jint-config-test");
    Bun.write(tmpDir + "/jint.config.json", JSON.stringify({ input: ".", exclude: [] }));

    // Should exit 2 (CONFIG_INVALID) because key is empty: fail fast, nothing walked
    Bun.write(tmpDir + "/input.ts", "// content");
    const proc = await runCli(["input.ts", "--json"], {
      cwd: tmpDir,
      env: { TYPESAFE_API_KEY: "" },
    });
    expect(proc.code).toBe(2);
    rmScratchTree(tmpDir);
  });

  slowTest("broken JSON -> CONFIG_INVALID, exit 2", async () => {
    const tmpDir = scratchDir("jint-config-broken");
    Bun.write(tmpDir + "/jint.config.json", "{ broken: true }");

    const proc = await runCli(["--json"], { cwd: tmpDir, env: { TYPESAFE_API_KEY: "" } });
    expect(proc.code).toBe(2);
    rmScratchTree(tmpDir);
  });
});

describe("cli: --dry-run prints the rules that would run, without classifying", () => {
  slowTest("two-rule config: block on stderr, empty stdout, exit 0, no requests dir", async () => {
    const tmpDir = scratchDir("jint-dryrun");
    Bun.write(
      tmpDir + "/jint.config.json",
      JSON.stringify({ rules: ["is_name_purposeful", "will_comment_drift"], exclude: [] }),
    );

    const proc = await runCli(["--dry-run"], { cwd: tmpDir, env: { TYPESAFE_API_KEY: "" } });
    expect(proc.code).toBe(0);
    expect(proc.stdout).toBe("");
    const err = proc.stderr;
    expect(err).toContain("jint: measuring with 2 rules");
    expect(err).toContain("is_name_purposeful  [definitions]");
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

  slowTest("--disable narrows the printed set to the effective rules", async () => {
    const tmpDir = scratchDir("jint-dryrun-disable");
    Bun.write(
      tmpDir + "/jint.config.json",
      JSON.stringify({ rules: ["is_name_purposeful", "will_comment_drift"], exclude: [] }),
    );

    const proc = await runCli(["--dry-run", "--disable", "is_name_purposeful"], {
      cwd: tmpDir,
      env: { TYPESAFE_API_KEY: "" },
    });
    expect(proc.code).toBe(0);
    const err = proc.stderr;
    expect(err).toContain("jint: measuring with 1 rules");
    expect(err).toContain("will_comment_drift");
    expect(err).not.toContain("is_name_purposeful");
    rmScratchTree(tmpDir);
  });

  slowTest("config resolving to zero rules: CONFIG_NO_RULES, exit 2", async () => {
    const tmpDir = scratchDir("jint-dryrun-empty");
    Bun.write(tmpDir + "/jint.config.json", JSON.stringify({ rules: [], exclude: [] }));

    const proc = await runCli(["--dry-run"], { cwd: tmpDir, env: { TYPESAFE_API_KEY: "" } });
    expect(proc.code).toBe(2);
    expect(proc.stderr).toContain("CONFIG_NO_RULES");
    rmScratchTree(tmpDir);
  });
});
