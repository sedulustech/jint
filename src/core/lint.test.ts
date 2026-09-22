import { describe, test, expect } from "bun:test";
import { defineConfig } from "../config/define.ts";
import { lint, collectReport } from "../core/lint.ts";
import { sensorDefaults } from "../core/sensors/defaults.ts";
import { AppError, type Judge, type LintEvent, type Sensor } from "../core/types.ts";

const baseConfig = defineConfig({
  input: "",
  sensors: { ...sensorDefaults, disable: [] },
  exclude: [],
});

/**
 * The comment family at silent readings; tests spread over it so each case names only what it
 * asserts about.
 */
const SILENT_COMMENT_FAMILY = {
  is_comment_business_context: 0.5,
  is_comment_narration: 0.1,
  is_comment_patching_readability: 0.1,
  will_comment_drift: 0.1,
  is_naming_convention_consistent: 0.9,
};

function judgeWith(values: Record<string, number>): Judge {
  return async () => ({ ...SILENT_COMMENT_FAMILY, ...values });
}

async function drain(events: AsyncIterable<LintEvent>): Promise<LintEvent[]> {
  const out: LintEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("lint", () => {
  test("streams measurement per (sensor, unit), signal only when the handle fires", async () => {
    const events = await drain(
      lint({
        config: baseConfig,
        input: "tests/fixtures/sample-file.ts",
        judge: judgeWith({
          is_name_purposeful: 0.3,
          is_vocabulary_consistent: 0.9,
          is_greppable: 0.8,
          is_comment_business_context: 1.0,
          is_cognitively_complex: 0.3,
        }),
      }),
    );
    const measurements = events.filter((e) => e.type === "measurement");
    const signals = events.filter((e) => e.type === "signal");
    expect(measurements).toHaveLength(9);
    // is_name_purposeful 0.3 -> error; everything else null - including
    // business_context at 1.0 (measurement-only in v0, no handle)
    expect(signals).toHaveLength(1);
    expect(signals[0]!.signal).toEqual({
      sensor: "is_name_purposeful",
      input: "tests/fixtures/sample-file.ts",
      value: 0.3,
      severity: "error",
    });
  });

  test("every measurement precedes its signal (two-stage model)", async () => {
    const events = await drain(
      lint({
        config: baseConfig,
        input: "tests/fixtures/sample-file.ts",
        judge: judgeWith({
          is_name_purposeful: 0.2,
          is_vocabulary_consistent: 0.2,
          is_greppable: 0.2,
          is_cognitively_complex: 0.8,
        }),
      }),
    );
    const kinds = events.map((e) => e.type);
    for (let i = 0; i < events.length; i++) {
      if (kinds[i] === "signal") expect(kinds[i - 1]).toBe("measurement");
    }
    // four readings clear their handles (business_context never does)
    expect(events.filter((e) => e.type === "signal")).toHaveLength(4);
  });

  test("--disable removes sensors by name before measuring", async () => {
    const questionsSeen: string[][] = [];
    const judge: Judge = async (_state, questions) => {
      questionsSeen.push(Object.keys(questions));
      return { is_name_purposeful: 0.7 };
    };
    const events = await drain(
      lint({
        config: baseConfig,
        input: "tests/fixtures/sample-file.ts",
        disable: [
          "is_comment_business_context",
          "is_comment_narration",
          "is_comment_patching_readability",
          "will_comment_drift",
          "is_cognitively_complex",
          "is_vocabulary_consistent",
          "is_naming_convention_consistent",
          "is_greppable",
        ],
        judge,
      }),
    );
    expect(questionsSeen[0]).toEqual(["is_name_purposeful"]);
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(1);
  });

  test("diff input decomposes into per-file units with calibrated state", async () => {
    const states: unknown[] = [];
    const judge: Judge = async (state) => {
      states.push(state);
      return {
        ...SILENT_COMMENT_FAMILY,
        is_name_purposeful: 0.7,
        is_vocabulary_consistent: 0.9,
        is_greppable: 0.8,
        is_cognitively_complex: 0.3,
      };
    };
    const events = await drain(
      lint({ config: baseConfig, input: "tests/fixtures/sample.diff", inputType: "diff", judge }),
    );
    const paths = states.map((s) => (s as { path: string }).path);
    expect(paths).toEqual([
      "src/tui/components/overlays/box.ts",
      "src/tui/components/overlays/help.ts",
    ]); // deleted + binary skipped
    expect((states[0] as { commit_message: string | null }).commit_message).toBeNull();
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(18);
  });

  test("per-unit failure becomes a diagnostic; the run continues", async () => {
    let calls = 0;
    const judge: Judge = async () => {
      calls++;
      if (calls === 1) throw new AppError("JEV_UNAVAILABLE", "first unit hiccup");
      return {
        ...SILENT_COMMENT_FAMILY,
        is_name_purposeful: 0.7,
        is_vocabulary_consistent: 0.9,
        is_greppable: 0.8,
        is_cognitively_complex: 0.3,
      };
    };
    const events = await drain(
      lint({
        config: baseConfig,
        input: ["tests/fixtures/sample-file.ts", "tests/fixtures/sample-dir/good.ts"],
        judge,
      }),
    );
    const diagnostics = events.filter(
      (e): e is Extract<LintEvent, { type: "diagnostic" }> => e.type === "diagnostic",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.diagnostic.code).toBe("JEV_UNAVAILABLE");
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(9); // second unit measured
  });

  test("JEV_AUTH aborts the run after surfacing the diagnostic (no hammering)", async () => {
    let calls = 0;
    const judge: Judge = async () => {
      calls++;
      throw new AppError("JEV_AUTH", "jev rejected the API key");
    };
    const events = await drain(
      lint({
        config: baseConfig,
        input: [
          "tests/fixtures/sample-file.ts",
          "tests/fixtures/sample-dir/good.ts",
          "tests/fixtures/sample-dir/sub/more.ts",
        ],
        judge,
      }),
    );
    expect(calls).toBe(1); // aborted, not once per unit
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("diagnostic");
    if (events[0]!.type === "diagnostic") expect(events[0]!.diagnostic.code).toBe("JEV_AUTH");
  });

  test("empty input -> CONFIG_INVALID throw (setup error, not a diagnostic)", async () => {
    try {
      await drain(lint({ config: baseConfig, input: "", judge: judgeWith({}) }));
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe("CONFIG_INVALID");
    }
  });

  test("exclude patterns apply to dir walking", async () => {
    const events = await drain(
      lint({
        config: baseConfig,
        input: "tests/fixtures/sample-dir",
        inputType: "dir",
        exclude: ["**/more.ts"],
        judge: judgeWith({
          is_name_purposeful: 0.7,
          is_vocabulary_consistent: 0.9,
          is_greppable: 0.8,
          is_cognitively_complex: 0.3,
        }),
      }),
    );
    const inputs = new Set(
      events.filter((e) => e.type === "measurement").map((e) => e.measurement.input),
    );
    expect(inputs).toEqual(new Set(["good.ts"]));
  });

  test("custom sensor set (selection = the sensor list itself)", async () => {
    const only: Sensor[] = [sensorDefaults.is_name_purposeful!];
    const config = defineConfig({ input: "", sensors: [only[0]!] });
    const events = await drain(
      lint({
        config,
        input: "tests/fixtures/sample-file.ts",
        judge: judgeWith({ is_name_purposeful: 0.7 }),
      }),
    );
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(1);
  });
});

describe("collectReport", () => {
  test("drains the stream into measurements/signals/diagnostics", async () => {
    const report = await collectReport(
      lint({
        config: baseConfig,
        input: "tests/fixtures/sample-file.ts",
        judge: judgeWith({
          is_name_purposeful: 0.3,
          is_vocabulary_consistent: 0.9,
          is_greppable: 0.8,
          is_cognitively_complex: 0.3,
        }),
      }),
    );
    expect(report.measurements).toHaveLength(9);
    expect(report.signals).toHaveLength(1);
    expect(report.diagnostics).toHaveLength(0);
  });
});
