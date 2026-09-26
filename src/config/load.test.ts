import { describe, test, expect } from "bun:test";
import { SetupError } from "../core/types.ts";
import { loadConfig, defaultConfig, validateConfig } from "./load.ts";

describe("loadConfig", () => {
  test("loads jint.config.json from the current dir", async () => {
    const tmpDir = "/tmp/jint-config-test-" + Math.random().toString(36).substring(7);
    Bun.spawnSync(["mkdir", "-p", tmpDir]);
    Bun.write(tmpDir + "/jint.config.json", JSON.stringify({ input: ".", exclude: [] }));

    // Should exit 2 (CONFIG_INVALID) because key is empty: fail fast, nothing walked
    Bun.write(tmpDir + "/input.ts", "// content");
    const proc = Bun.spawnSync(
      ["bun", new URL("../../", import.meta.url).pathname + "/src/cli.ts", "input.ts", "--json"],
      {
        cwd: tmpDir,
        env: { ...process.env, TYPESAFE_API_KEY: "" },
      },
    );
    expect(proc.exitCode).toBe(2);
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  });

  test("broken JSON -> CONFIG_INVALID, exit 2", async () => {
    const tmpDir = "/tmp/jint-config-broken-" + Math.random().toString(36).substring(7);
    Bun.spawnSync(["mkdir", "-p", tmpDir]);
    Bun.write(tmpDir + "/jint.config.json", "{ broken: true }");

    const proc = Bun.spawnSync(
      ["bun", new URL("../../", import.meta.url).pathname + "/src/cli.ts", "--json"],
      {
        cwd: tmpDir,
        env: { ...process.env, TYPESAFE_API_KEY: "" },
      },
    );
    expect(proc.exitCode).toBe(2);
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  });

  test("loads a valid JSON config: disable + exclude applied", async () => {
    const config = await loadConfig("tests/fixtures/configs/valid.config.json");
    expect(config.input).toBe("tests/fixtures/sample-dir");
    expect(config.rules.map((s) => s.name)).not.toContain("will_comment_drift");
    expect(config.exclude).toEqual(["**/more.ts"]);
  });

  test("missing file -> CONFIG_INVALID", async () => {
    expect(loadConfig("no/such/config.json")).rejects.toThrow(SetupError);
    expect(loadConfig("no/such/config.json")).rejects.toThrow(/config file not found/);
  });

  test("invalid JSON syntax -> CONFIG_INVALID with the parse error", async () => {
    try {
      await loadConfig("tests/fixtures/configs/broken.json.txt");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SetupError);
      expect((e as SetupError).code).toBe("CONFIG_INVALID");
      expect((e as SetupError).message).toContain("not valid JSON");
    }
  });

  test("invalid shape -> CONFIG_INVALID with joined TypeBox messages", async () => {
    try {
      await loadConfig("tests/fixtures/configs/invalid.config.json");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SetupError);
      expect((e as SetupError).code).toBe("CONFIG_INVALID");
      expect((e as SetupError).message).toContain("invalid.config.json");
      expect((e as SetupError).message).toContain("input");
    }
  });

  test("incomplete data handle -> CONFIG_INVALID", async () => {
    try {
      await loadConfig("tests/fixtures/configs/badhandle.config.json");
      expect.unreachable();
    } catch (e) {
      expect((e as SetupError).code).toBe("CONFIG_INVALID");
      expect((e as SetupError).message).toContain("/rules/0");
    }
  });

  test("unknown default rule name -> CONFIG_INVALID", async () => {
    expect(() => validateConfig({ input: "x", rules: ["no_such_rule"] }, "inline")).toThrow(
      /unknown default rule name/,
    );
  });
});

describe("validateConfig / defaultConfig", () => {
  test("defaultConfig carries every default rule and no input", () => {
    const config = defaultConfig();
    expect(config.input).toBe("");
    expect(config.rules).toHaveLength(12);
  });

  test("no rules key = all defaults; strings select defaults; objects override by name (last wins)", () => {
    const all = validateConfig({ input: "x" }, "inline");
    expect(all.rules).toHaveLength(12);

    const selected = validateConfig({ input: "x", rules: ["is_greppable"] }, "inline");
    expect(selected.rules.map((r) => r.name)).toEqual(["is_greppable"]);

    const overridden = validateConfig(
      {
        input: "x",
        rules: [
          {
            name: "is_greppable",
            criteria: { true: "t", false: "f" },
            target: "files",
            handle: { warn_at: 0.7, error_at: 0.5 },
          },
        ],
      },
      "inline",
    );
    expect(overridden.rules).toHaveLength(1);
  });

  test("data handles compile to the function form; polarity inferred from ordering", () => {
    // warn_at < error_at: high-bad — value above warn_at warns, above error_at errors
    const highBad = validateConfig(
      {
        input: "x",
        rules: [
          {
            name: "r",
            criteria: { true: "t", false: "f" },
            target: "files",
            handle: { warn_at: 0.3, error_at: 0.45 },
          },
        ],
      },
      "inline",
    );
    const bad = highBad.rules[0]!.handle;
    expect(bad(0.1)).toBeNull();
    expect(bad(0.35)).toBe("warn");
    expect(bad(0.5)).toBe("error");

    // error_at < warn_at: high-good — value below warn_at warns, below error_at errors
    const highGood = validateConfig(
      {
        input: "x",
        rules: [
          {
            name: "r",
            criteria: { true: "t", false: "f" },
            target: "files",
            handle: { warn_at: 0.6, error_at: 0.5 },
          },
        ],
      },
      "inline",
    );
    const good = highGood.rules[0]!.handle;
    expect(good(0.9)).toBeNull();
    expect(good(0.55)).toBe("warn");
    expect(good(0.4)).toBe("error");
  });

  test("equal thresholds -> CONFIG_INVALID; null handle = classify-only", () => {
    const equal = {
      input: "x",
      rules: [
        {
          name: "r",
          criteria: { true: "t", false: "f" },
          target: "files",
          handle: { warn_at: 0.5, error_at: 0.5 },
        },
      ],
    };
    try {
      validateConfig(equal, "inline");
      expect.unreachable();
    } catch (e) {
      expect((e as SetupError).code).toBe("CONFIG_INVALID");
      expect((e as SetupError).message).toContain("must differ");
    }

    const silent = validateConfig(
      {
        input: "x",
        rules: [{ name: "r", criteria: { true: "t", false: "f" }, target: "files", handle: null }],
      },
      "inline",
    );
    expect(silent.rules[0]!.handle(0.99)).toBeNull();
  });

  test("$schema and unknown top-level keys are accepted and ignored", () => {
    const config = validateConfig(
      { $schema: "./jint.schema.json", note: "mine", input: "x" },
      "inline",
    );
    expect(config.input).toBe("x");
  });

  test("choice rules validate against the discriminated union", () => {
    const config = validateConfig(
      {
        input: "x",
        rules: [
          {
            name: "r",
            kind: "choice",
            instructions: "score it",
            criteria: ["clear", "opaque"],
            target: "definitions",
            handle: { warn_at: 1, error_at: 2 },
          },
        ],
      },
      "inline",
    );
    expect(config.rules[0]!.handle(3)).toBe("error");
    expect(config.rules[0]!.handle(2)).toBe("warn");
  });

  test("disable removes by name after assembly", () => {
    const config = validateConfig({ input: "x", disable: ["is_greppable"] }, "inline");
    expect(config.rules.map((r) => r.name)).not.toContain("is_greppable");
    expect(config.rules).toHaveLength(11);
  });
});
