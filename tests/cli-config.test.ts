import { describe, test, expect } from "bun:test";
import { runCliSync } from "./helpers/cli.ts";

// CONFIG_INVALID exits 2 through the real CLI (moved here from the sdk's load.test.ts when
// @jint/sdk was split out: sdk unit tests must not spawn the cli).
describe("cli: config load errors exit 2", () => {
  test("loads jint.config.json from the current dir", async () => {
    const tmpDir = "/tmp/jint-config-test-" + Math.random().toString(36).substring(7);
    Bun.spawnSync(["mkdir", "-p", tmpDir]);
    Bun.write(tmpDir + "/jint.config.json", JSON.stringify({ input: ".", exclude: [] }));

    // Should exit 2 (CONFIG_INVALID) because key is empty: fail fast, nothing walked
    Bun.write(tmpDir + "/input.ts", "// content");
    const proc = runCliSync(["input.ts", "--json"], { cwd: tmpDir, env: { TYPESAFE_API_KEY: "" } });
    expect(proc.code).toBe(2);
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  });

  test("broken JSON -> CONFIG_INVALID, exit 2", async () => {
    const tmpDir = "/tmp/jint-config-broken-" + Math.random().toString(36).substring(7);
    Bun.spawnSync(["mkdir", "-p", tmpDir]);
    Bun.write(tmpDir + "/jint.config.json", "{ broken: true }");

    const proc = runCliSync(["--json"], { cwd: tmpDir, env: { TYPESAFE_API_KEY: "" } });
    expect(proc.code).toBe(2);
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  });
});

describe("cli: --dry-run prints the rules that would run, without classifying", () => {
  test("two-rule config: block on stderr, empty stdout, exit 0, no requests dir", async () => {
    const tmpDir = "/tmp/jint-dryrun-" + Math.random().toString(36).substring(7);
    Bun.spawnSync(["mkdir", "-p", tmpDir]);
    Bun.write(
      tmpDir + "/jint.config.json",
      JSON.stringify({ rules: ["is_name_purposeful", "will_comment_drift"], exclude: [] }),
    );

    const proc = runCliSync(["--dry-run"], { cwd: tmpDir, env: { TYPESAFE_API_KEY: "" } });
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
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  });

  test("--disable narrows the printed set to the effective rules", async () => {
    const tmpDir = "/tmp/jint-dryrun-disable-" + Math.random().toString(36).substring(7);
    Bun.spawnSync(["mkdir", "-p", tmpDir]);
    Bun.write(
      tmpDir + "/jint.config.json",
      JSON.stringify({ rules: ["is_name_purposeful", "will_comment_drift"], exclude: [] }),
    );

    const proc = runCliSync(["--dry-run", "--disable", "is_name_purposeful"], {
      cwd: tmpDir,
      env: { TYPESAFE_API_KEY: "" },
    });
    expect(proc.code).toBe(0);
    const err = proc.stderr;
    expect(err).toContain("jint: measuring with 1 rules");
    expect(err).toContain("will_comment_drift");
    expect(err).not.toContain("is_name_purposeful");
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  });

  test("config resolving to zero rules: CONFIG_NO_RULES, exit 2", async () => {
    const tmpDir = "/tmp/jint-dryrun-empty-" + Math.random().toString(36).substring(7);
    Bun.spawnSync(["mkdir", "-p", tmpDir]);
    Bun.write(tmpDir + "/jint.config.json", JSON.stringify({ rules: [], exclude: [] }));

    const proc = runCliSync(["--dry-run"], { cwd: tmpDir, env: { TYPESAFE_API_KEY: "" } });
    expect(proc.code).toBe(2);
    expect(proc.stderr).toContain("CONFIG_NO_RULES");
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  });
});
