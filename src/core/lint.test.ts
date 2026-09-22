import { describe, test, expect } from "bun:test";
import { defineConfig } from "../config/define.ts";
import { lint, collectReport } from "../core/lint.ts";
import { sensorDefaults } from "../core/sensors/defaults.ts";
import { AppError, type AnyState, type Judge, type LintEvent, type Sensor } from "../core/types.ts";

const baseConfig = defineConfig({
  input: "",
  sensors: { ...sensorDefaults, disable: [] },
  exclude: [],
});

const FILE = "tests/fixtures/sample-file.ts"; // two definitions, no comments: d0, d1

/**
 * The full sensor set at handle-silent readings; tests spread over it so each case names only what
 * it asserts about. Every unspecified sensor answers silent in both regimes.
 */
const SILENT = {
  is_name_purposeful: 0.9,
  is_vocabulary_consistent: 0.9,
  is_naming_convention_consistent: 0.9,
  is_greppable: 0.9,
  is_comment_business_context: 0.5,
  is_comment_narration: 0.1,
  is_comment_patching_readability: 0.1,
  will_comment_drift: 0.1,
  is_cognitively_complex: 0.3,
};

/**
 * Same fixed per-sensor answers for every call, keyed by the asked question name (sweep questions
 * are "block-N.<sensor>", everything else plain "<sensor>") — exactly how the real judge answers.
 */
function judgeWith(values: Record<string, number>): Judge {
  return async (_state, questions) => {
    const out: Record<string, number> = {};
    for (const key of Object.keys(questions)) {
      const dot = key.indexOf(".");
      const sensor = dot === -1 ? key : key.slice(dot + 1);
      out[key] = values[key] ?? values[sensor] ?? SILENT[sensor as keyof typeof SILENT] ?? 0.5;
    }
    return out;
  };
}

interface CallLog {
  calls: Array<{ state: AnyState; questions: string[] }>;
}

/** A judge that records every call (state shape + question keys) — funnel-shape assertions. */
function loggingJudge(values: Record<string, number>, log: CallLog): Judge {
  const inner = judgeWith(values);
  return async (state, questions) => {
    log.calls.push({ state, questions: Object.keys(questions) });
    return inner(state, questions);
  };
}

const isSweep = (state: AnyState): boolean => "blocks" in state;

async function drain(events: AsyncIterable<LintEvent>): Promise<LintEvent[]> {
  const out: LintEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("lint — funnel shape", () => {
  test("one sweep call per file with array state + labeled questions; files-target call separate", async () => {
    const log: CallLog = { calls: [] };
    await drain(lint({ config: baseConfig, input: FILE, judge: loggingJudge({}, log) }));
    const sweeps = log.calls.filter((c) => isSweep(c.state));
    expect(sweeps).toHaveLength(1);
    const sweep = sweeps[0]!;
    expect(sweep.state).toEqual({
      path: FILE,
      blocks: [
        { label: "block-0", content: expect.stringContaining("addSeconds") },
        { label: "block-1", content: expect.stringContaining("formatDuration") },
      ],
    });
    // one question per (block-leaf, non-files-target sensor): 2 definitions x 7
    expect(sweep.questions).toHaveLength(14);
    expect(sweep.questions).toContain("block-0.is_name_purposeful");
    expect(sweep.questions).toContain("block-1.is_cognitively_complex");
    // the files-target sensors keep their own whole-content call
    const whole = log.calls.filter((c) => !isSweep(c.state));
    expect(whole.length).toBeGreaterThanOrEqual(1);
    expect(whole[0]!.questions).toEqual(
      expect.arrayContaining(["is_vocabulary_consistent", "is_greppable"]),
    );
  });

  test("isolated confirm calls happen only for sweep candidates", async () => {
    const log: CallLog = { calls: [] };
    // purposeful 0.3 sweeps below 0.5 -> both blocks candidates; complex 0.3 stays quiet
    await drain(
      lint({
        config: baseConfig,
        input: FILE,
        judge: loggingJudge({ is_name_purposeful: 0.3, is_cognitively_complex: 0.3 }, log),
      }),
    );
    // isolated confirm calls: whole-content-shaped states that are NOT the file itself
    const source = await Bun.file(FILE).text();
    const leafCalls = log.calls.filter(
      (c) => !isSweep(c.state) && "content" in c.state && c.state.content !== source,
    );
    expect(leafCalls).toHaveLength(2); // one per flagged leaf, no others
    for (const c of leafCalls) {
      expect(c.questions).toEqual([
        "is_name_purposeful",
        "is_naming_convention_consistent",
        "is_comment_business_context",
        "is_comment_narration",
        "is_comment_patching_readability",
        "will_comment_drift",
        "is_cognitively_complex",
      ]);
    }
  });

  test("confirmed signals aggregate max over leaves (high=bad) and carry block locations", async () => {
    // complex sweeps above 0.55 -> both blocks; confirmed per block: 0.5 and 0.9 -> max 0.9.
    // The isolated calls ask plain sensor names, so block identity routes on the leaf content.
    const judge: Judge = async (state, questions) => {
      const sweep = "blocks" in state;
      const leaf = !sweep && "content" in state && state.content.includes("formatDuration");
      const out: Record<string, number> = {};
      for (const key of Object.keys(questions)) {
        const sensor = key.includes(".") ? key.slice(key.indexOf(".") + 1) : key;
        let value = SILENT[sensor as keyof typeof SILENT];
        if (sensor === "is_cognitively_complex") value = sweep ? 0.9 : leaf ? 0.9 : 0.5;
        out[key] = value;
      }
      return out;
    };
    const events = await drain(lint({ config: baseConfig, input: FILE, judge }));
    const signals = events.filter((e) => e.type === "signal");
    expect(signals).toHaveLength(1);
    const s = signals[0]!.signal as unknown as Record<string, unknown>;
    expect(s.sensor).toBe("is_cognitively_complex");
    expect(s.value).toBe(0.9);
    expect(s.severity).toBe("error");
    expect(s.input).toBe(FILE + "#block-1"); // the extreme leaf's location
    expect(s.location).toEqual({ input: FILE + "#block-1", span: expect.any(Object) });
  });

  test("high=good sensors aggregate min over leaves", async () => {
    // purposeful 0.3 sweeps both blocks; confirmed 0.3 everywhere -> min, one signal
    const events = await drain(
      lint({ config: baseConfig, input: FILE, judge: judgeWith({ is_name_purposeful: 0.3 }) }),
    );
    const signals = events.filter((e) => e.type === "signal");
    expect(signals).toHaveLength(1);
    const s = signals[0]!.signal as unknown as Record<string, unknown>;
    expect(s.value).toBe(0.3);
    expect(s.severity).toBe("error");
    expect(s.input).toBe(FILE + "#block-0");
  });

  test("sweep flags are not verdicts: signals come only from the confirm regime", async () => {
    // sweep 0.49 crosses the 0.50 anchor (candidate) while the confirm reading 0.7 clears the
    // handle: if the sweep reading could fire a handle, a signal would exist
    const events = await drain(
      lint({
        config: baseConfig,
        input: FILE,
        judge: judgeWith({
          "block-0.is_name_purposeful": 0.49,
          "block-1.is_name_purposeful": 0.49,
          is_name_purposeful: 0.7,
        }),
      }),
    );
    expect(events.filter((e) => e.type === "signal")).toHaveLength(0);
  });

  test("degenerate file: degrades to the coarsest leaf (whole file) with a warn diagnostic", async () => {
    const empty = "tests/fixtures/tmp-empty.ts";
    await Bun.write(empty, String.fromCharCode(10));
    try {
      const log: CallLog = { calls: [] };
      const events = await drain(
        lint({ config: baseConfig, input: empty, judge: loggingJudge({}, log) }),
      );
      // two calls: files-target sensors on whole content, then the sweep over ONE
      // whole-file leaf - the coarsest target, not a legacy path (design 7.2)
      expect(log.calls).toHaveLength(2);
      expect(isSweep(log.calls[0]!.state)).toBe(false);
      expect(isSweep(log.calls[1]!.state)).toBe(true);
      const sweep = log.calls[1]!;
      const blocks = (sweep.state as unknown as { blocks: unknown[] }).blocks;
      expect(blocks).toHaveLength(1);
      const measurements = events.filter((e) => e.type === "measurement");
      expect(measurements).toHaveLength(9);
      const diags = events.filter(
        (e) =>
          e.type === "diagnostic" &&
          (e.diagnostic as { code?: string }).code === "DECOMPOSITION_DEGRADED",
      );
      expect(diags).toHaveLength(1);
      expect((diags[0] as { diagnostic: { severity?: string } }).diagnostic.severity).toBe("warn");
    } finally {
      const shell = Bun.spawnSync(["rm", empty]);
      expect(shell.exitCode).toBe(0);
    }
  });
});

describe("lint", () => {
  test("streams measurement per (sensor, unit), signal only when the handle fires", async () => {
    const events = await drain(
      lint({
        config: baseConfig,
        input: FILE,
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
    // file call 2 + sweep 14 + confirm 14 (both blocks flagged by purposeful 0.3)
    expect(measurements).toHaveLength(30);
    // purposeful 0.3 -> one aggregated error at the extreme leaf; business_context at 1.0
    // never fires (measurement-only in v0)
    expect(signals).toHaveLength(1);
    expect(signals[0]!.signal).toEqual({
      sensor: "is_name_purposeful",
      input: FILE + "#block-0",
      value: 0.3,
      severity: "error",
      location: { input: FILE + "#block-0", span: expect.any(Object) },
    });
  });

  test("every measurement precedes its signal (two-stage model)", async () => {
    const events = await drain(
      lint({
        config: baseConfig,
        input: FILE,
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
      // aggregated confirm signals batch at the end of a file, so pair loosely:
      // a signal must be preceded by at least one measurement of the same file
      if (kinds[i] === "signal") expect(kinds.slice(0, i).includes("measurement")).toBe(true);
    }
    // vocabulary 0.2 + greppable 0.2 (file call) + complex 0.8 (max over two confirmed
    // leaves, error) + purposeful 0.2 (min, error)
    expect(events.filter((e) => e.type === "signal")).toHaveLength(4);
  });

  test("--disable removes sensors by name before measuring", async () => {
    const log: CallLog = { calls: [] };
    const events = await drain(
      lint({
        config: baseConfig,
        input: FILE,
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
        judge: loggingJudge({ is_name_purposeful: 0.7 }, log),
      }),
    );
    // purposeful targets definitions: sweep only, no whole-content call, no confirm
    // (0.7 is above the sweep anchor)
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0]!.questions).toEqual([
      "block-0.is_name_purposeful",
      "block-1.is_name_purposeful",
    ]);
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(2);
  });

  test("diff input decomposes into per-file units with calibrated state (legacy path)", async () => {
    const states: unknown[] = [];
    const inner = judgeWith({
      is_name_purposeful: 0.7,
      is_vocabulary_consistent: 0.9,
      is_greppable: 0.8,
      is_cognitively_complex: 0.3,
    });
    const judge: Judge = async (state, questions) => {
      states.push(state);
      return inner(state, questions);
    };
    const events = await drain(
      lint({ config: baseConfig, input: "tests/fixtures/sample.diff", inputType: "diff", judge }),
    );
    // two judge calls per file (files-target + sweep), same path - dedupe for the assertion
    const paths = [...new Set(states.map((s) => (s as { path: string }).path))];
    expect(paths).toEqual([
      "src/tui/components/overlays/box.ts",
      "src/tui/components/overlays/help.ts",
    ]); // deleted + binary skipped
    expect((states[0] as { commit_message: string | null }).commit_message).toBeNull();
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(18);
  });

  test("per-unit failure becomes a diagnostic; the run continues", async () => {
    const judge: Judge = async (state, questions) => {
      if (state.path === FILE) throw new AppError("JEV_UNAVAILABLE", "first unit hiccup");
      return judgeWith({
        is_name_purposeful: 0.7,
        is_vocabulary_consistent: 0.9,
        is_greppable: 0.8,
        is_cognitively_complex: 0.3,
      })(state, questions);
    };
    const events = await drain(
      lint({
        config: baseConfig,
        input: [FILE, "tests/fixtures/sample-dir/good.ts"],
        judge,
      }),
    );
    const diagnostics = events.filter(
      (e): e is Extract<LintEvent, { type: "diagnostic" }> => e.type === "diagnostic",
    );
    // both of the failed file's calls (whole-content + sweep) surface a diagnostic
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]!.diagnostic.code).toBe("JEV_UNAVAILABLE");
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(16); // second unit: 2 file + 14 sweep
  });

  test("JEV_AUTH aborts the run after surfacing the diagnostics (bounded, no hammering)", async () => {
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
    // the wave bound (4) caps in-flight probes: each of the 3 files calls exactly once before
    // the abort flag stops everything further
    expect(calls).toBe(3);
    expect(events).toHaveLength(3);
    for (const e of events) {
      expect(e.type).toBe("diagnostic");
      if (e.type === "diagnostic") expect(e.diagnostic.code).toBe("JEV_AUTH");
    }
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
    expect(inputs).toEqual(new Set(["good.ts", "good.ts#block-0", "good.ts#block-1"]));
  });

  test("custom sensor set (selection = the sensor list itself)", async () => {
    const only: Sensor[] = [sensorDefaults.is_name_purposeful!];
    const config = defineConfig({ input: "", sensors: [only[0]!] });
    const events = await drain(
      lint({
        config,
        input: FILE,
        judge: judgeWith({ is_name_purposeful: 0.7 }),
      }),
    );
    // definitions target: 2 sweep questions, no candidates at 0.7
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(2);
  });
});

describe("collectReport", () => {
  test("drains the stream into measurements/signals/diagnostics", async () => {
    const report = await collectReport(
      lint({
        config: baseConfig,
        input: FILE,
        judge: judgeWith({
          is_name_purposeful: 0.3,
          is_vocabulary_consistent: 0.9,
          is_greppable: 0.8,
          is_cognitively_complex: 0.3,
        }),
      }),
    );
    expect(report.measurements).toHaveLength(30);
    expect(report.signals).toHaveLength(1);
    expect(report.diagnostics).toHaveLength(0);
  });
});
