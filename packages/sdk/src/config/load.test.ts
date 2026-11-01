import { describe, test, expect } from "bun:test";
import { catalogConfig, catalog } from "../../tests/test-baseline.ts";
import { SetupError } from "../core/types.ts";
import { loadConfig, validateConfig } from "./load.ts";

describe("loadConfig", () => {
  test("loads a valid JSON config: disable + exclude applied", async () => {
    const config = await loadConfig("tests/fixtures/configs/valid.config.json", {
      catalog,
    });
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

  test("incomplete data handle -> CONFIG_INVALID, detail names the first rule-path error", async () => {
    try {
      await loadConfig("tests/fixtures/configs/badhandle.config.json");
      expect.unreachable();
    } catch (e) {
      expect((e as SetupError).code).toBe("CONFIG_INVALID");
      expect((e as SetupError).message).toContain("/rules/use/0");
      expect((e as SetupError).detail).toEqual({
        kind: "invalid-rule",
        ruleIndex: 0,
        field: "instructions",
        present: false,
      });
    }
  });

  test("unknown rule name -> CONFIG_INVALID (and it names the missing catalog)", () => {
    expect(() =>
      validateConfig({ input: "x", rules: { use: ["no_such_rule"] } }, "inline", catalog),
    ).toThrow(/unknown rule name/);
    expect(() =>
      validateConfig({ input: "x", rules: { use: ["no_such_rule"] } }, "inline"),
    ).toThrow(/no rule catalog was provided/);
  });

  test("unknown rule name detail: the catalog vocabulary + closest match as data", () => {
    try {
      validateConfig({ input: "x", rules: { use: ["is_greppble"] } }, "inline", catalog);
      expect.unreachable();
    } catch (e) {
      const detail = (e as SetupError).detail;
      expect(detail?.kind).toBe("unknown-rule");
      if (detail?.kind === "unknown-rule") {
        expect(detail.valid.length).toBe(catalog ? Object.keys(catalog).length : 0);
        expect(detail.suggest).toBe("is_greppable");
      }
    }
  });

  test("a schema error outside a rule index throws WITHOUT detail", async () => {
    try {
      await loadConfig("tests/fixtures/configs/invalid.config.json");
      expect.unreachable();
    } catch (e) {
      // first error is /input (not a rule path): no invalid-rule detail
      expect((e as SetupError).detail).toBeUndefined();
    }
  });

  test("a rules-less config is a named setup error", () => {
    expect(() => validateConfig({ input: "x" }, "inline")).toThrow(/declares no rules/);
  });
});

describe("validateConfig / catalogConfig", () => {
  test("the catalog carries every domain rule and no input", () => {
    const config = catalogConfig();
    expect(config.input).toBe("");
    expect(config.rules).toHaveLength(10);
  });

  test("no rules key is an error that lists the domains; strings select catalog rules; objects declare their own", () => {
    expect(() => validateConfig({ input: "x" }, "inline", catalog)).toThrow(/no rules to run/);

    const selected = validateConfig(
      { input: "x", rules: { use: ["is_greppable"] } },
      "inline",
      catalog,
    );
    expect(selected.rules.map((r) => r.name)).toEqual(["is_greppable"]);

    const overridden = validateConfig(
      {
        input: "x",
        rules: {
          use: [
            {
              name: "is_greppable",
              instructions: "q",
              criteria: { true: "t", false: "f" },
              target: "files",
              handle: { warn: { less_than: 0.75 }, error: { less_than: 0.6 } },
            },
          ],
        },
      },
      "inline",
    );
    expect(overridden.rules).toHaveLength(1);
  });

  test("noul handlers compile to the function form; thresholds sit on the declared defect pole", () => {
    // greater_than: the reading itself is the defect probability
    const firesTrue = validateConfig(
      {
        input: "x",
        rules: {
          use: [
            {
              name: "r",
              instructions: "q",
              criteria: { true: "t", false: "f" },
              target: "files",
              handle: { warn: { greater_than: 0.3 }, error: { greater_than: 0.45 } },
            },
          ],
        },
      },
      "inline",
    );
    const t = firesTrue.rules[0]!.handle;
    expect(t({ value: 0.1 })).toBeNull();
    expect(t({ value: 0.35 })).toEqual({ severity: "warn" });
    expect(t({ value: 0.5 })).toEqual({ severity: "error" });

    // less_than: the low side is the defect (no flip - the operator declares it)
    const firesFalse = validateConfig(
      {
        input: "x",
        rules: {
          use: [
            {
              name: "r",
              instructions: "q",
              criteria: { true: "t", false: "f" },
              target: "files",
              handle: { warn: { less_than: 0.6 }, error: { less_than: 0.5 } },
            },
          ],
        },
      },
      "inline",
    );
    const f = firesFalse.rules[0]!.handle;
    expect(f({ value: 0.9 })).toBeNull();
    expect(f({ value: 0.55 })).toEqual({ severity: "warn" });
    expect(f({ value: 0.4 })).toEqual({ severity: "error" });

    // silent_band: defect-pole readings inside [lo, hi] stay silent
    const banded = validateConfig(
      {
        input: "x",
        rules: {
          use: [
            {
              name: "r",
              instructions: "q",
              criteria: { true: "t", false: "f" },
              target: "files",
              handle: { warn: { greater_than: 0.3 }, silent_band: [0.4, 0.6] },
            },
          ],
        },
      },
      "inline",
    );
    const b = banded.rules[0]!.handle;
    expect(b({ value: 0.5 })).toBeNull(); // inside the band
    expect(b({ value: 0.35 })).toEqual({ severity: "warn" }); // below the band still surfaces
    expect(b({ value: 0.7 })).toEqual({ severity: "warn" }); // above it too (no error_at declared)
  });

  test("handler validation names the rule and the exact field", () => {
    const rule = (handle: unknown) => ({
      input: "x",
      rules: {
        use: [
          {
            name: "r",
            instructions: "q",
            criteria: { true: "t", false: "f" },
            target: "files",
            handle,
          },
        ],
      },
    });
    expect(() => validateConfig(rule({ warn: { greater_than: 1.5 } }), "inline")).toThrow(
      /rule 'r' handle\.warn: threshold must be within \(0, 1\)/,
    );
    expect(() =>
      validateConfig(rule({ warn: { greater_than: 0.9 }, error: { greater_than: 0.5 } }), "inline"),
    ).toThrow(/rule 'r' handle\.warn\/error: .*warn < error/);
    expect(() =>
      validateConfig(rule({ warn: { greater_than: 0.3 }, silent_band: [0.6, 0.4] }), "inline"),
    ).toThrow(/rule 'r' handle\.silent_band: must be ordered/);
    expect(() =>
      validateConfig(rule({ warn: { greater_than: 0.3 }, silent_band: [0, 1] }), "inline"),
    ).toThrow(/rule 'r' handle\.silent_band: must not cover the whole scale/);
    expect(() =>
      validateConfig(rule({ warn: { greater_than: 0.3 }, silent_band: [0.2, 0.4] }), "inline"),
    ).toThrow(/rule 'r' handle\.silent_band:.*contains the warn threshold/);
    expect(() =>
      validateConfig(
        rule({
          warn: { greater_than: 0.3 },
          error: { greater_than: 0.7 },
          silent_band: [0.4, 0.75],
        }),
        "inline",
      ),
    ).toThrow(/rule 'r' handle\.silent_band:.*contains the error threshold/);
    // a noul handle declares at least one tier; error alone is enough
    expect(() => validateConfig(rule({}), "inline")).toThrow(
      /rule 'r' handle: must declare at least one tier/,
    );
    expect(() =>
      validateConfig(rule({ error: { greater_than: 0.6, message: "m" } }), "inline"),
    ).not.toThrow();
    // question-type vs handler-type mismatch, both directions
    expect(() => validateConfig(rule({ map: ["pass", "warn"] }), "inline")).toThrow(
      /rule 'r' handle\.map: a score handler on a noul rule/,
    );
    expect(() =>
      validateConfig(
        {
          input: "x",
          rules: {
            use: [
              {
                name: "r",
                kind: "score",
                instructions: "score it",
                criteria: ["clear", "opaque"],
                target: "definitions",
                handle: { warn: { greater_than: 0.3 } },
              },
            ],
          },
        },
        "inline",
      ),
    ).toThrow(/rule 'r' handle: a noul handler on a score rule/);
  });

  test("handle-less rule is REJECTED (policy is not optional; probes ship real handles)", () => {
    expect(() =>
      validateConfig(
        {
          input: "x",
          rules: {
            use: [
              { name: "r", criteria: { true: "t", false: "f" }, target: "files", handle: null },
            ],
          },
        },
        "inline",
      ),
    ).toThrow(/Expected union value/);
    expect(() =>
      validateConfig(
        {
          input: "x",
          rules: {
            use: [
              {
                name: "r",
                instructions: "q",
                criteria: { true: "t", false: "f" },
                target: "files",
              },
            ],
          },
        },
        "inline",
      ),
    ).toThrow(/invalid config inline/);
  });

  test("$schema and unknown top-level keys are accepted and ignored", () => {
    const config = validateConfig(
      {
        $schema: "./jint.schema.json",
        note: "mine",
        input: "x",
        rules: { use: ["is_greppable"] },
      },
      "inline",
      catalog,
    );
    expect(config.input).toBe("x");
  });

  test("choice rules load: named options, a tier per label", () => {
    const config = validateConfig(
      {
        input: "x",
        rules: {
          use: [
            {
              name: "r",
              kind: "choice",
              instructions: "which option?",
              criteria: { justified: "fine", wrong: "contradicted" },
              target: "comments",
              handle: {
                choices: { justified: "pass", wrong: { level: "error", message: "Fix it." } },
              },
            },
          ],
        },
      },
      "inline",
    );
    const rule = config.rules[0]!;
    expect(rule.kind).toBe("choice");
    expect(rule.handle({ value: 0.8, choice: "wrong" })).toEqual({
      severity: "error",
      message: "Fix it.",
    });
  });

  test("a choice rule needs at least two options", () => {
    expect(() =>
      validateConfig(
        {
          input: "x",
          rules: {
            use: [
              {
                name: "r",
                kind: "choice",
                instructions: "which option?",
                criteria: { only: "the one option" },
                target: "comments",
                handle: { choices: { only: "error" } },
              },
            ],
          },
        },
        "inline",
      ),
    ).toThrow(/criteria Expected object to have at least 2 properties/);
  });

  test("score rules validate against the discriminated union", () => {
    const config = validateConfig(
      {
        input: "x",
        rules: {
          use: [
            {
              name: "r",
              kind: "score",
              instructions: "score it",
              criteria: ["clear", "opaque"],
              target: "definitions",
              handle: { map: ["pass", "warn"] },
            },
          ],
        },
      },
      "inline",
    );
    const handle = config.rules[0]!.handle;
    expect(handle({ value: 1 })).toEqual({ severity: "warn" });
    expect(handle({ value: 0 })).toBeNull();
    // Off-rubric scores are impossible states (the provider bounds the score to the criteria count);
    // they fail loud rather than silently dropping the reading.
    expect(() => handle({ value: 7 })).toThrow(/outside the criteria scale/);
    expect(() => handle({ value: Number.NaN })).toThrow(/outside the criteria scale/);
  });

  test("score map length must equal the criteria count; at least one non-ok", () => {
    const rule = (map: string[]) => ({
      input: "x",
      rules: {
        use: [
          {
            name: "r",
            kind: "score",
            instructions: "score it",
            criteria: ["clear", "opaque"],
            target: "definitions",
            handle: { map },
          },
        ],
      },
    });
    expect(() => validateConfig(rule(["pass", "warn", "error"]), "inline")).toThrow(
      /rule 'r' handle\.map: map has 3 level\(s\) but the criteria has 2/,
    );
    expect(() => validateConfig(rule(["pass", "pass"]), "inline")).toThrow(
      /rule 'r' handle\.map: at least one level must be non-pass/,
    );
  });

  test("run knobs validate with the field named; flags/config precedence lives above", () => {
    const config = (overrides: Record<string, unknown>) =>
      validateConfig(
        { input: "x", rules: { use: ["is_greppable"] }, ...overrides },
        "inline",
        catalog,
      );
    expect(config({ concurrency: 8 }).concurrency).toBe(8);
    expect(() => config({ concurrency: 0 })).toThrow(/concurrency: must be an integer >= 1/);
    expect(() => config({ concurrency: 65 })).toThrow(/concurrency: must be <= 64/);
  });

  test("url loads; a wrong-typed url is rejected", () => {
    const config = (overrides: Record<string, unknown>) =>
      validateConfig(
        { input: "x", rules: { use: ["is_greppable"] }, ...overrides },
        "inline",
        catalog,
      );
    expect(config({ url: "http://x/v1/decisions", apiKey: "k" }).url).toBe("http://x/v1/decisions");
    expect(() => config({ url: 3 })).toThrow();
  });

  test("per-rule scoping: validation names rule+field; full cancellation warns, never errors", () => {
    const rule = (scope: Record<string, unknown>) => ({
      input: "x",
      rules: {
        use: [
          {
            name: "r",
            instructions: "q",
            criteria: { true: "t", false: "f" },
            target: "files",
            handle: { warn: { greater_than: 0.3 }, error: { greater_than: 0.7 } },
            ...scope,
          },
        ],
      },
    });
    expect(() => validateConfig(rule({ include: [] }), "inline")).toThrow(
      /rule 'r' include: must be a non-empty array/,
    );
    expect(() => validateConfig(rule({ exclude: ["pass", ""] }), "inline")).toThrow(
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
    const config = validateConfig(
      {
        input: "x",
        rules: { use: ["is_greppable", "is_function_srp"] },
        disable: ["is_greppable"],
      },
      "inline",
      catalog,
    );
    expect(config.rules.map((r) => r.name)).toEqual(["is_function_srp"]);
  });
});

describe("retired top-level scope keys", () => {
  test("top-level include/exclude are a hard error naming the move (extra keys are otherwise ignored)", () => {
    expect(() =>
      validateConfig({ rules: { use: [] }, exclude: ["**/*.md"] }, "inline", {}, [], true),
    ).toThrow(/top-level exclude moved under rules/);
    expect(() =>
      validateConfig(
        { rules: { use: [] }, include: ["src/**"], exclude: [] },
        "inline",
        {},
        [],
        true,
      ),
    ).toThrow(/top-level include and exclude moved under rules/);
  });

  test("a rules array is a hard error naming the new shape", () => {
    expect(() => validateConfig({ rules: ["is_greppable"] }, "inline", {}, [], true)).toThrow(
      /rules is now an object - write rules: \{ use: \[\.\.\.\] \}/,
    );
  });

  test("rules.include/exclude resolve to the config scope", () => {
    const config = validateConfig(
      { rules: { include: ["src/**"], exclude: ["**/gen/**"], use: [] } },
      "inline",
      {},
      [],
      true,
    );
    expect(config.include).toEqual(["src/**"]);
    expect(config.exclude).toEqual(["**/gen/**"]);
  });
});
