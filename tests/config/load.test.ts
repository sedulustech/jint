import { describe, test, expect } from "bun:test";
import { loadConfig, defaultConfig, validateConfig, DEFAULT_CONFIG_PATH } from "../../src/config/load.ts";
import { AppError } from "../../src/core/types.ts";

const ROOT = "/home/crjm/dev/sedulus/jint";
describe("loadConfig", () => {
  test("loads from jint.config.ts in current dir", async () => {
    const tmpDir = "/tmp/jint-config-test-" + Math.random().toString(36).substring(7);
    Bun.spawnSync(["mkdir", "-p", tmpDir]);
    Bun.write(tmpDir + "/jint.config.ts", 'export default { input: ".", sensors: [{ name: "noop", description: "noop sensor", inputTypes: ["file"], handle: () => null }], exclude: [] };');
    
    // Should exit 4 (JEV_AUTH) because key is empty
    Bun.write(tmpDir + "/input.ts", "// content");
    const proc = Bun.spawnSync(["bun", ROOT + "/src/cli.ts", "--file", "input.ts", "--json"], {
      cwd: tmpDir,
      env: { ...process.env, TYPESAFE_API_KEY: "" }
    });
    expect(proc.exitCode).toBe(4);
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  });

  test("broken jint.config.ts exits 2 CONFIG_INVALID", async () => {
    const tmpDir = "/tmp/jint-config-broken-" + Math.random().toString(36).substring(7);
    Bun.spawnSync(["mkdir", "-p", tmpDir]);
    Bun.write(tmpDir + "/jint.config.ts", 'export default { broken: true };');
    
    const proc = Bun.spawnSync(["bun", ROOT + "/src/cli.ts", "--json"], {
      cwd: tmpDir,
      env: { ...process.env, TYPESAFE_API_KEY: "" }
    });
    expect(proc.exitCode).toBe(2);
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  });

  test("loads a valid defineConfig file", async () => {
    const config = await loadConfig("tests/fixtures/configs/valid.config.ts");
    expect(config.input).toBe("tests/fixtures/sample-dir");
    expect(config.sensors.map((s) => s.name)).not.toContain("will_comment_drift");
    expect(config.exclude).toEqual(["**/more.ts"]);
  });

  test("missing file -> CONFIG_INVALID", async () => {
    expect(loadConfig("no/such/config.ts")).rejects.toThrow(AppError);
    expect(loadConfig("no/such/config.ts")).rejects.toThrow(/config file not found/);
  });

  test("invalid shape -> CONFIG_INVALID with joined TypeBox messages", async () => {
    try {
      await loadConfig("tests/fixtures/configs/invalid.config.ts");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("CONFIG_INVALID");
      expect((e as AppError).message).toContain("invalid.config.ts");
      expect((e as AppError).message).toContain("input");
    }
  });

  test("non-function handle -> CONFIG_INVALID", async () => {
    try {
      await loadConfig("tests/fixtures/configs/nohandle.config.ts");
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe("CONFIG_INVALID");
      expect((e as AppError).message).toContain("handle must be a function");
    }
  });

  test("no default export -> CONFIG_INVALID", async () => {
    try {
      await loadConfig("tests/fixtures/configs/noexport.config.ts");
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe("CONFIG_INVALID");
      expect((e as AppError).message).toContain("default export");
    }
  });
});

describe("validateConfig / defaultConfig", () => {
  test("defaultConfig carries every default sensor and no input", () => {
    const config = defaultConfig();
    expect(config.input).toBe("");
    expect(config.sensors).toHaveLength(8);
  });

  test("validateConfig rejects sensors that are not an array", () => {
    try {
      validateConfig({ input: "x", sensors: {}, exclude: [] }, "inline");
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe("CONFIG_INVALID");
    }
  });
});
