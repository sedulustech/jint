import { describe, test, expect } from "bun:test";

// CONFIG_INVALID exits 2 through the real CLI (moved here from the sdk's load.test.ts when
// @jint/sdk was split out: sdk unit tests must not spawn the cli).
describe("cli: config load errors exit 2", () => {
  const CLI = import.meta.dir + "/../src/cli.ts";

  test("loads jint.config.json from the current dir", async () => {
    const tmpDir = "/tmp/jint-config-test-" + Math.random().toString(36).substring(7);
    Bun.spawnSync(["mkdir", "-p", tmpDir]);
    Bun.write(tmpDir + "/jint.config.json", JSON.stringify({ input: ".", exclude: [] }));

    // Should exit 2 (CONFIG_INVALID) because key is empty: fail fast, nothing walked
    Bun.write(tmpDir + "/input.ts", "// content");
    const proc = Bun.spawnSync(["bun", CLI, "input.ts", "--json"], {
      cwd: tmpDir,
      env: { ...process.env, TYPESAFE_API_KEY: "" },
    });
    expect(proc.exitCode).toBe(2);
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  });

  test("broken JSON -> CONFIG_INVALID, exit 2", async () => {
    const tmpDir = "/tmp/jint-config-broken-" + Math.random().toString(36).substring(7);
    Bun.spawnSync(["mkdir", "-p", tmpDir]);
    Bun.write(tmpDir + "/jint.config.json", "{ broken: true }");

    const proc = Bun.spawnSync(["bun", CLI, "--json"], {
      cwd: tmpDir,
      env: { ...process.env, TYPESAFE_API_KEY: "" },
    });
    expect(proc.exitCode).toBe(2);
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  });
});
