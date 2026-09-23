import { describe, test, expect } from "bun:test";
import { SetupError } from "../core/types.ts";
import { loadConfig, defaultConfig, validateConfig } from "./load.ts";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
describe("loadConfig", () => {
  test("loads from jint.config.ts in current dir", async () => {
    const tmpDir = "/tmp/jint-config-test-" + Math.random().toString(36).substring(7);
    Bun.spawnSync(["mkdir", "-p", tmpDir]);
    Bun.write(
      tmpDir + "/jint.config.ts",
      'export default { input: ".", rules: [{ name: "noop", criteria: { true: "noop holds", false: "it does not" }, target: "files", handle: () => null }], exclude: [] };',
    );

    // Should exit 4 (JEV_AUTH) because key is empty
    Bun.write(tmpDir + "/input.ts", "// content");
    const proc = Bun.spawnSync(["bun", ROOT + "/src/cli.ts", "--file", "input.ts", "--json"], {
      cwd: tmpDir,
      env: { ...process.env, TYPESAFE_API_KEY: "" },
    });
    expect(proc.exitCode).toBe(4);
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  });

  test("broken jint.config.ts exits 2 CONFIG_INVALID", async () => {
    const tmpDir = "/tmp/jint-config-broken-" + Math.random().toString(36).substring(7);
    Bun.spawnSync(["mkdir", "-p", tmpDir]);
    Bun.write(tmpDir + "/jint.config.ts", "export default { broken: true };");

    const proc = Bun.spawnSync(["bun", ROOT + "/src/cli.ts", "--json"], {
      cwd: tmpDir,
      env: { ...process.env, TYPESAFE_API_KEY: "" },
    });
    expect(proc.exitCode).toBe(2);
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  });

  test("loads a valid defineConfig file", async () => {
    const config = await loadConfig("tests/fixtures/configs/valid.config.ts");
    expect(config.input).toBe("tests/fixtures/sample-dir");
    expect(config.rules.map((s) => s.name)).not.toContain("will_comment_drift");
    expect(config.exclude).toEqual(["**/more.ts"]);
  });

  test("missing file -> CONFIG_INVALID", async () => {
    expect(loadConfig("no/such/config.ts")).rejects.toThrow(SetupError);
    expect(loadConfig("no/such/config.ts")).rejects.toThrow(/config file not found/);
  });

  test("invalid shape -> CONFIG_INVALID with joined TypeBox messages", async () => {
    try {
      await loadConfig("tests/fixtures/configs/invalid.config.ts");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SetupError);
      expect((e as SetupError).code).toBe("CONFIG_INVALID");
      expect((e as SetupError).message).toContain("invalid.config.ts");
      expect((e as SetupError).message).toContain("input");
    }
  });

  test("non-function handle -> CONFIG_INVALID", async () => {
    try {
      await loadConfig("tests/fixtures/configs/nohandle.config.ts");
      expect.unreachable();
    } catch (e) {
      expect((e as SetupError).code).toBe("CONFIG_INVALID");
      expect((e as SetupError).message).toContain("handle must be a function");
    }
  });

  test("no default export -> CONFIG_INVALID", async () => {
    try {
      await loadConfig("tests/fixtures/configs/noexport.config.ts");
      expect.unreachable();
    } catch (e) {
      expect((e as SetupError).code).toBe("CONFIG_INVALID");
      expect((e as SetupError).message).toContain("default export");
    }
  });
});

describe("validateConfig / defaultConfig", () => {
  test("defaultConfig carries every default rule and no input", () => {
    const config = defaultConfig();
    expect(config.input).toBe("");
    expect(config.rules).toHaveLength(10);
  });

  test("validateConfig rejects rules that are not an array", () => {
    try {
      validateConfig({ input: "x", rules: {}, exclude: [] }, "inline");
      expect.unreachable();
    } catch (e) {
      expect((e as SetupError).code).toBe("CONFIG_INVALID");
    }
  });
});
