import { describe, test, expect } from "bun:test";
import { defineConfig } from "../config/define.ts";
import { lint, collectReport } from "../core/lint.ts";
import { sensorDefaults } from "../core/sensors/defaults.ts";
import { blockWireId } from "../core/sensors/funnel.ts";
import {
  RequestError,
  SetupError,
  type AnyState,
  type Judge,
  type LintEvent,
  type Sensor,
} from "../core/types.ts";

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
 * Same fixed per-sensor answers for every call, keyed by the asked question id (sweep questions are
 * "<sensor> in <sha8 wire id>", everything else plain "<sensor>") — how the real judge answers.
 */
function sensorOf(key: string): string {
  const sep = key.indexOf(" in ");
  return sep === -1 ? key : key.slice(0, sep);
}

function judgeWith(values: Record<string, number>): Judge {
  return async (_state, questions) => {
    const out: Record<string, number> = {};
    for (const key of Object.keys(questions)) {
      const sensor = sensorOf(key);
      out[key] =
        values[key] ??
        (sensor !== "" ? values[sensor] : undefined) ??
        (sensor !== "" ? SILENT[sensor as keyof typeof SILENT] : undefined) ??
        Object.values(values)[0] ??
        0.5;
    }
    return out;
  };
}

interface CallLog {
  calls: Array<{ state: AnyState; questions: string[]; specs: Record<string, unknown> }>;
}

/** A judge that records every call (state shape + question keys) — funnel-shape assertions. */
function loggingJudge(values: Record<string, number>, log: CallLog): Judge {
  const inner = judgeWith(values);
  return async (state, questions) => {
    log.calls.push({
      state,
      questions: Object.keys(questions),
      specs: questions as unknown as Record<string, unknown>,
    });
    if (process.env.DBG)
      console.log(
        "CALL",
        JSON.stringify({ isSweep: "blocks" in state, keys: Object.keys(questions) }),
      );
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
  test("one sweep call per file with array state + documented noul questions; files-target call separate", async () => {
    const log: CallLog = { calls: [] };
    await drain(lint({ config: baseConfig, input: FILE, judge: loggingJudge({}, log) }));
    const sweeps = log.calls.filter((c) => isSweep(c.state));
    expect(sweeps).toHaveLength(1);
    const sweep = sweeps[0]!;
    // wire ids are content-hashed; the positional "block-N" labels live only in reports
    const sweepState = sweep.state as unknown as {
      blocks: ReadonlyArray<{ id: string; content: string }>;
    };
    expect(sweepState.blocks).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f]{8}$/),
        content: expect.stringContaining("addSeconds"),
      },
      {
        id: expect.stringMatching(/^[0-9a-f]{8}$/),
        content: expect.stringContaining("formatDuration"),
      },
    ]);
    // wire ids are the content hash of each block's swept content
    const blockIds = sweepState.blocks.map((b) => b.id);
    expect(blockIds).toEqual(sweepState.blocks.map((b) => blockWireId(b.content)));
    // one question per (block-leaf, non-files-target sensor): 2 definitions x 7
    expect(sweep.questions).toHaveLength(14);
    expect(sweep.questions).toContain(`is_name_purposeful in ${blockIds[0]}`);
    expect(sweep.questions).toContain(`is_cognitively_complex in ${blockIds[1]}`);
    // criteria-as-rule: instructions is the one-element wire-id array, criteria is the rule
    for (const [key, spec] of Object.entries(sweep.specs)) {
      const s = spec as {
        type: string;
        instructions: unknown;
        criteria?: { true: string; false: string };
      };
      expect(s.type).toBe("noul");
      const unitId = key.slice(key.indexOf(" in ") + 4);
      expect(s.instructions).toEqual([unitId]);
      expect(s.criteria).toBeDefined();
      // criteria is the sensor's actual rule, never the generic form
      expect(s.criteria!.true).not.toContain("described property");
    }
    // the files-target sensors keep their own whole-content call
    const whole = log.calls.filter((c) => !isSweep(c.state));
    expect(whole.length).toBeGreaterThanOrEqual(1);
    // whole-content call questions are keyed "<sensor> in <file id>" (the content hash)
    for (const key of whole[0]!.questions) {
      expect(key).toMatch(/^is_(vocabulary_consistent|greppable) in [0-9a-f]{8}$/);
    }
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
      // confirm questions are keyed "<sensor> in <leaf wire id>" — the same sha the sweep used
      expect(c.questions).toHaveLength(7);
      for (const key of c.questions) {
        expect(key).toMatch(/^\S+ in [0-9a-f]{8}$/);
      }
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
        const sensor = sensorOf(key);
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
        judge: async (state, questions) => {
          const sweep = "blocks" in state;
          const out: Record<string, number> = {};
          for (const key of Object.keys(questions)) {
            const sensor = sensorOf(key);
            out[key] =
              sensor === "is_name_purposeful"
                ? sweep
                  ? 0.49
                  : 0.7
                : (SILENT[sensor as keyof typeof SILENT] ?? 0.5);
          }
          return out;
        },
      }),
    );
    expect(events.filter((e) => e.type === "signal")).toHaveLength(0);
  });

  test("degenerate file: degrades to the coarsest leaf (whole file) with a degradation", async () => {
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
      const degraded = events.filter(
        (e): e is Extract<LintEvent, { type: "degradation" }> => e.type === "degradation",
      );
      expect(degraded).toHaveLength(1);
      expect(degraded[0]!.degradation.code).toBe("DECOMPOSITION_DEGRADED");
      expect(degraded[0]!.degradation.message).toContain("measured whole");
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
    expect(log.calls[0]!.questions).toHaveLength(2);
    for (const key of log.calls[0]!.questions) {
      expect(key).toMatch(/^[0-9a-f]{8}$/); // single sensor -> bare unit-id keys
    }
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

  test("per-unit failure becomes a streamed error; the run continues", async () => {
    const judge: Judge = async (state, questions) => {
      if (state.path === FILE)
        throw new RequestError("JEV_UNAVAILABLE", state.path, "first unit hiccup");
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
    const errors = events.filter(
      (e): e is Extract<LintEvent, { type: "error" }> => e.type === "error",
    );
    // both of the failed file's calls (whole-content + sweep) surface an error
    expect(errors).toHaveLength(2);
    expect(errors[0]!.error.code).toBe("JEV_UNAVAILABLE");
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(16); // second unit: 2 file + 14 sweep
  });

  test("JEV_AUTH aborts the run after surfacing the errors (bounded, no hammering)", async () => {
    let calls = 0;
    const judge: Judge = async (state) => {
      calls++;
      throw new RequestError("JEV_AUTH", state.path, "jev rejected the API key");
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
      expect(e.type).toBe("error");
      if (e.type === "error") expect(e.error.code).toBe("JEV_AUTH");
    }
  });

  test("empty input -> CONFIG_INVALID throw (SetupError, not a streamed error)", async () => {
    try {
      await drain(lint({ config: baseConfig, input: "", judge: judgeWith({}) }));
      expect.unreachable();
    } catch (e) {
      expect((e as SetupError).code).toBe("CONFIG_INVALID");
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
  test("drains the stream into measurements/signals/errors/degradations", async () => {
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
    expect(report.errors).toHaveLength(0);
    expect(report.degradations).toHaveLength(0);
  });
});
