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
            handle: { fires_when: "false", warn_at: 0.25, error_at: 0.4 },
          },
        ],
      },
      "inline",
    );
    expect(overridden.rules).toHaveLength(1);
  });

  test("noul handlers compile to the function form; thresholds sit on the declared defect pole", () => {
    // fires_when "true": the reading itself is the defect probability
    const firesTrue = validateConfig(
      {
        input: "x",
        rules: [
          {
            name: "r",
            criteria: { true: "t", false: "f" },
            target: "files",
            handle: { fires_when: "true", warn_at: 0.3, error_at: 0.45 },
          },
        ],
      },
      "inline",
    );
    const t = firesTrue.rules[0]!.handle;
    expect(t(0.1)).toBeNull();
    expect(t(0.35)).toEqual({ severity: "warn" });
    expect(t(0.5)).toEqual({ severity: "error" });

    // fires_when "false": P flips to the defect pole first
    const firesFalse = validateConfig(
      {
        input: "x",
        rules: [
          {
            name: "r",
            criteria: { true: "t", false: "f" },
            target: "files",
            handle: { fires_when: "false", warn_at: 0.4, error_at: 0.5 },
          },
        ],
      },
      "inline",
    );
    const f = firesFalse.rules[0]!.handle;
    expect(f(0.9)).toBeNull();
    expect(f(0.55)).toEqual({ severity: "warn" });
    expect(f(0.4)).toEqual({ severity: "error" });

    // silent_band: defect-pole readings inside [lo, hi] stay silent
    const banded = validateConfig(
      {
        input: "x",
        rules: [
          {
            name: "r",
            criteria: { true: "t", false: "f" },
            target: "files",
            handle: { fires_when: "true", warn_at: 0.3, silent_band: [0.4, 0.6] },
          },
        ],
      },
      "inline",
    );
    const b = banded.rules[0]!.handle;
    expect(b(0.5)).toBeNull(); // inside the band
    expect(b(0.35)).toEqual({ severity: "warn" }); // below the band still surfaces
    expect(b(0.7)).toEqual({ severity: "warn" }); // above it too (no error_at declared)
  });

  test("handler validation names the rule and the exact field", () => {
    const rule = (handle: unknown) => ({
      input: "x",
      rules: [{ name: "r", criteria: { true: "t", false: "f" }, target: "files", handle }],
    });
    expect(() => validateConfig(rule({ fires_when: "true", warn_at: 1.5 }), "inline")).toThrow(
      /rule 'r' handle\.warn_at: must be within \(0, 1\)/,
    );
    expect(() =>
      validateConfig(rule({ fires_when: "true", warn_at: 0.9, error_at: 0.5 }), "inline"),
    ).toThrow(/rule 'r' handle\.warn_at: .*warn_at < error_at/);
    expect(() =>
      validateConfig(rule({ fires_when: "true", warn_at: 0.3, silent_band: [0.6, 0.4] }), "inline"),
    ).toThrow(/rule 'r' handle\.silent_band: must be ordered/);
    expect(() =>
      validateConfig(rule({ fires_when: "true", warn_at: 0.3, silent_band: [0, 1] }), "inline"),
    ).toThrow(/rule 'r' handle\.silent_band: must not cover the whole scale/);
    expect(() =>
      validateConfig(rule({ fires_when: "true", warn_at: 0.3, silent_band: [0.2, 0.4] }), "inline"),
    ).toThrow(/rule 'r' handle\.silent_band:.*contains handle\.warn_at/);
    expect(() =>
      validateConfig(
        rule({ fires_when: "true", warn_at: 0.3, error_at: 0.7, silent_band: [0.4, 0.75] }),
        "inline",
      ),
    ).toThrow(/rule 'r' handle\.silent_band:.*contains handle\.error_at/);
    // question-type vs handler-type mismatch, both directions
    expect(() => validateConfig(rule({ map: ["ok", "warn"] }), "inline")).toThrow(
      /rule 'r' handle\.map: a score handler on a noul rule/,
    );
    expect(() =>
      validateConfig(
        {
          input: "x",
          rules: [
            {
              name: "r",
              kind: "choice",
              instructions: "score it",
              criteria: ["clear", "opaque"],
              target: "definitions",
              handle: { fires_when: "true", warn_at: 0.3 },
            },
          ],
        },
        "inline",
      ),
    ).toThrow(/rule 'r' handle\.fires_when: a noul handler on a choice rule/);
  });

  test("null handle = classify-only", () => {
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
            handle: { map: ["ok", "warn"] },
          },
        ],
      },
      "inline",
    );
    const handle = config.rules[0]!.handle;
    expect(handle(1)).toEqual({ severity: "warn", message: "opaque" });
    expect(handle(0)).toBeNull();
    // Off-rubric scores are impossible states (jev bounds the score to the criteria count);
    // they fail loud rather than silently dropping the reading.
    expect(() => handle(7)).toThrow(/outside the criteria scale/);
    expect(() => handle(Number.NaN)).toThrow(/outside the criteria scale/);
  });

  test("score map length must equal the criteria count; at least one non-ok", () => {
    const rule = (map: string[]) => ({
      input: "x",
      rules: [
        {
          name: "r",
          kind: "choice",
          instructions: "score it",
          criteria: ["clear", "opaque"],
          target: "definitions",
          handle: { map },
        },
      ],
    });
    expect(() => validateConfig(rule(["ok", "warn", "error"]), "inline")).toThrow(
      /rule 'r' handle\.map: map has 3 level\(s\) but the criteria has 2/,
    );
    expect(() => validateConfig(rule(["ok", "ok"]), "inline")).toThrow(
      /rule 'r' handle\.map: at least one level must be non-ok/,
    );
  });

  test("run knobs validate with the field named; flags/config precedence lives above", () => {
    const config = (overrides: Record<string, unknown>) =>
      validateConfig({ input: "x", ...overrides }, "inline");
    expect(config({ concurrency: 8 }).concurrency).toBe(8);
    expect(config({ rps_budget: 12.5 }).rps_budget).toBe(12.5);
    expect(() => config({ concurrency: 0 })).toThrow(/concurrency: must be an integer >= 1/);
    expect(() => config({ concurrency: 65 })).toThrow(/concurrency: must be <= 64/);
    expect(() => config({ rps_budget: 0 })).toThrow(/rps_budget: must be a number > 0/);
    expect(() => config({ rps_budget: -1 })).toThrow(/rps_budget: must be a number > 0/);
  });

  test("per-rule scoping: validation names rule+field; full cancellation warns, never errors", () => {
    const rule = (scope: Record<string, unknown>) => ({
      input: "x",
      rules: [
        {
          name: "r",
          criteria: { true: "t", false: "f" },
          target: "files",
          handle: { fires_when: "true", warn_at: 0.3, error_at: 0.7 },
          ...scope,
        },
      ],
    });
    expect(() => validateConfig(rule({ include: [] }), "inline")).toThrow(
      /rule 'r' include: must be a non-empty array/,
    );
    expect(() => validateConfig(rule({ exclude: ["ok", ""] }), "inline")).toThrow(
      /rule 'r' exclude: every entry must be a non-empty glob string/,
    );
    expect(() => validateConfig(rule({ include: ["!tests/**"] }), "inline")).toThrow(
      /rule 'r' include: negated globs/,
    );
    // exclude fully cancelling include is LEGAL: a warning rides the config as a note
    const cancelled = validateConfig(rule({ include: ["src/**"], exclude: ["src/**"] }), "inline");
    expect(cancelled.warnings).toHaveLength(1);
    expect(cancelled.warnings![0]).toContain("rule 'r'");
    // overlapping-but-not-equal globs do not warn
    const overlapping = validateConfig(
      rule({ include: ["src/**"], exclude: ["src/generated/**"] }),
      "inline",
    );
    expect(overlapping.warnings).toBeUndefined();
  });

  test("disable removes by name after assembly", () => {
    const config = validateConfig({ input: "x", disable: ["is_greppable"] }, "inline");
    expect(config.rules.map((r) => r.name)).not.toContain("is_greppable");
    expect(config.rules).toHaveLength(11);
  });
});
