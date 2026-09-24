import { describe, test, expect } from "bun:test";
import { defineConfig } from "../config/define.ts";
import { lint, collectReport } from "../core/lint.ts";
import { defaultRules } from "../core/sensors/defaults.ts";
import {
  MeasureError,
  SetupError,
  type AnyState,
  type Classifier,
  type LintEvent,
  type Rule,
} from "../core/types.ts";

const baseConfig = defineConfig({
  input: "",
  rules: { ...defaultRules, disable: [] },
  exclude: [],
});

const FILE = "tests/fixtures/sample-file.ts"; // two definitions, no comments: d0, d1

/**
 * The full rule set at handle-silent readings; tests spread over it so each case names only what it
 * asserts about. Every unspecified rule answers silent in both regimes.
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
  is_function_srp: 0.9,
};

/**
 * Same fixed per-rule answers for every call, keyed by the asked question id (element questions are
 * "<rule> in <sha8 wire id>", everything else plain "<rule>") — how the real classifier answers.
 */
function sensorOf(key: string): string {
  const sep = key.indexOf(" in ");
  return sep === -1 ? key : key.slice(0, sep);
}

function classifierWith(values: Record<string, number>): Classifier {
  return async (_state, questions) => {
    const out: Record<string, number> = {};
    for (const key of Object.keys(questions)) {
      const rule = sensorOf(key);
      out[key] =
        values[key] ??
        (rule !== "" ? values[rule] : undefined) ??
        (rule !== "" ? SILENT[rule as keyof typeof SILENT] : undefined) ??
        Object.values(values)[0] ??
        0.5;
    }
    return out;
  };
}

interface CallLog {
  calls: Array<{ state: AnyState; questions: string[]; specs: Record<string, unknown> }>;
}

/** A classifier that records every call (state shape + question keys) — classification assertions. */
function loggingClassifier(values: Record<string, number>, log: CallLog): Classifier {
  const inner = classifierWith(values);
  return async (state, questions) => {
    log.calls.push({
      state,
      questions: Object.keys(questions),
      specs: questions as unknown as Record<string, unknown>,
    });
    if (process.env.DBG)
      console.log(
        "CALL",
        JSON.stringify({ isSweep: "elements" in state, keys: Object.keys(questions) }),
      );
    return inner(state, questions);
  };
}

const isSweep = (state: AnyState): boolean => "elements" in state;

const COMMENT_SENSORS = [
  "is_comment_business_context",
  "is_comment_narration",
  "is_comment_patching_readability",
  "will_comment_drift",
];
const DEFINITION_SENSORS = [
  "is_name_purposeful",
  "is_naming_convention_consistent",
  "is_cognitively_complex",
];

test("classification respects rule targets: comment rules never judge bare definitions, definition rules never judge comment elements", async () => {
  const log: CallLog = { calls: [] };
  await drain(
    lint({
      config: baseConfig,
      input: "tests/fixtures/targeted-file.ts",
      classifier: loggingClassifier({}, log),
    }),
  );
  const sweep = log.calls.filter((c) => isSweep(c.state))[0]!;
  const elements = (
    sweep.state as unknown as { elements: ReadonlyArray<{ id: string; content: string }> }
  ).elements;
  const isCommentBlock = new Map(elements.map((b) => [b.id, !b.content.includes("export ")]));
  for (const key of sweep.questions) {
    const rule = key.slice(0, key.indexOf(" in "));
    const unitId = key.slice(key.indexOf(" in ") + 4);
    const commentBlock = isCommentBlock.get(unitId)!;
    if (COMMENT_SENSORS.includes(rule)) {
      // comment-family rules may judge comment elements and definitions WITH attached docblocks,
      // but never a bare definition (nothing to classifier)
      const content = elements.find((b) => b.id === unitId)?.content ?? "";
      expect(commentBlock || content.includes("//")).toBe(true);
    }
    if (DEFINITION_SENSORS.includes(rule)) {
      expect(commentBlock).toBe(false);
    }
  }
});

async function drain(events: AsyncIterable<LintEvent>): Promise<LintEvent[]> {
  const out: LintEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("lint — classification shape", () => {
  test("one batched element-classification call per file + documented noul questions; files-target call separate", async () => {
    const log: CallLog = { calls: [] };
    await drain(lint({ config: baseConfig, input: FILE, classifier: loggingClassifier({}, log) }));
    const sweeps = log.calls.filter((c) => isSweep(c.state));
    expect(sweeps).toHaveLength(1);
    const sweep = sweeps[0]!;
    // wire ids are LOC intervals, used verbatim in report inputs
    const sweepState = sweep.state as unknown as {
      elements: ReadonlyArray<{ id: string; content: string }>;
    };
    expect(sweepState.elements).toEqual([
      {
        id: expect.stringMatching(/^L\d+(-L\d+)?$/),
        content: expect.stringContaining("addSeconds"),
      },
      {
        id: expect.stringMatching(/^L\d+(-L\d+)?$/),
        content: expect.stringContaining("formatDuration"),
      },
    ]);
    // wire ids are the treesitter LOC interval of each block's swept content
    const blockIds = sweepState.elements.map((b) => b.id);
    expect(new Set(blockIds).size).toBe(blockIds.length); // disjoint spans -> unique ids
    // per (element, target-matched rule): L2-L4 carries the module docblock -> 8 rules,
    // L6-L11 is a bare definition -> 4 definition-target rules (design 7.7 targeting)
    expect(sweep.questions).toHaveLength(14);
    expect(sweep.questions).toContain(`is_name_purposeful in ${blockIds[0]}`);
    expect(sweep.questions).toContain(`is_cognitively_complex in ${blockIds[1]}`);
    // criteria-as-rule: instructions map the unit id to the task, criteria is the rule
    // (noul questions get UNIT_TASK; choice questions carry their own instructions sentence)
    for (const [, spec] of Object.entries(sweep.specs)) {
      const s = spec as {
        type: string;
        instructions: unknown;
        criteria?: { true: string; false: string };
      };
      expect(["noul", "score"]).toContain(s.type);
      expect(s.instructions).toBeDefined();
      expect(s.criteria).toBeDefined();
    }
    // the files-target rules keep their own whole-content call
    const whole = log.calls.filter((c) => !isSweep(c.state));
    expect(whole.length).toBeGreaterThanOrEqual(1);
    // whole-content call questions are keyed "<rule> in <file id>" (the content hash)
    for (const key of whole[0]!.questions) {
      expect(key).toMatch(/^is_(vocabulary_consistent|greppable) in L\d+(-L\d+)?$/);
    }
  });

  test("degenerate file: no elements, nothing swept - no whole-file judgment", async () => {
    const empty = "tests/fixtures/tmp-empty.ts";
    await Bun.write(empty, String.fromCharCode(10));
    try {
      const log: CallLog = { calls: [] };
      const events = await drain(
        lint({ config: baseConfig, input: empty, classifier: loggingClassifier({}, log) }),
      );
      // one call only: files-target rules on whole content. No sweep call at all -
      // an unparseable file yields no elements and there is no whole-file element judgment.
      expect(log.calls).toHaveLength(1);
      expect(isSweep(log.calls[0]!.state)).toBe(false);
      const measurements = events.filter((e) => e.type === "measurement");
      expect(measurements).toHaveLength(2); // whole-unit rules only
      const errors = events.filter(
        (e): e is Extract<LintEvent, { type: "error" }> => e.type === "error",
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error.code).toBe("MAPPING_FAILED");
      expect(errors[0]!.error.message).toContain("cannot map to elements");
    } finally {
      const shell = Bun.spawnSync(["rm", empty]);
      expect(shell.exitCode).toBe(0);
    }
  });

  test("classification never hands a whole-file element to any target, functions included", async () => {
    const log: CallLog = { calls: [] };
    await drain(lint({ config: baseConfig, input: FILE, classifier: loggingClassifier({}, log) }));
    const sweeps = log.calls.filter((c) => isSweep(c.state));
    expect(sweeps.length).toBeGreaterThan(0);
    const src = await Bun.file(FILE).text();
    for (const c of sweeps) {
      const elements = (c.state as unknown as { elements: { id: string; content: string }[] })
        .elements;
      for (const block of elements) {
        // no block IS the whole file - targets route over elements, never a file-shaped element
        expect(block.content).not.toBe(src);
        expect(block.id).not.toBe("L1-L" + src.split("\n").length);
      }
    }
  });

  test("empty inventory (no elements) produces no questions and no crash", async () => {
    const { classifyFile } = await import("./sensors/classify.ts");
    const empty = "tests/fixtures/tmp-empty-funnel.ts";
    await Bun.write(empty, String.fromCharCode(10));
    try {
      const calls: unknown[] = [];
      const result = await classifyFile(
        { kind: "file", state: { path: empty, content: "", id: "L1" } },
        Object.values(defaultRules),
        async (state, questions) => {
          calls.push({ state, questions });
          return {};
        },
      );
      // whole-unit call only; classification is skipped entirely (no elements -> early return)
      expect(calls).toHaveLength(1);
      expect(result.fatal).toBe(false);
      const sweepCalls = calls.filter((c) => isSweep((c as { state: AnyState }).state));
      expect(sweepCalls).toHaveLength(0);
    } finally {
      const shell = Bun.spawnSync(["rm", empty]);
      expect(shell.exitCode).toBe(0);
    }
  });
});

describe("lint", () => {
  test("streams measurement per (rule, unit), signal only when the handle fires", async () => {
    const events = await drain(
      lint({
        config: baseConfig,
        input: FILE,
        classifier: classifierWith({
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
    // file call 2 + element classification 14 (8 docblock + 4 bare definitions + 2 functions)
    expect(measurements).toHaveLength(16);
    // purposeful 0.3 fires (error) on BOTH elements - no aggregation, no candidacy;
    // business_context at 1.0 never fires (measurement-only in v0)
    expect(signals).toHaveLength(2);
    expect(signals.map((s) => s.signal.input)).toEqual([FILE + "#L2-L4", FILE + "#L6-L11"]);
    for (const s of signals) {
      expect(s.signal).toEqual({
        rule: "is_name_purposeful",
        input: s.signal.input,
        value: 0.3,
        severity: "error",
        location: { input: s.signal.input, span: expect.any(Object) },
      });
    }
  });

  test("single pass: every measurement runs its handle, each signal follows its measurement", async () => {
    const events = await drain(
      lint({
        config: baseConfig,
        input: FILE,
        classifier: classifierWith({
          is_name_purposeful: 0.2,
          is_vocabulary_consistent: 0.2,
          is_greppable: 0.2,
          is_cognitively_complex: 0.8,
        }),
      }),
    );
    const kinds = events.map((e) => e.type);
    for (let i = 0; i < events.length; i++) {
      // no aggregation: a signal directly follows its own measurement
      if (kinds[i] === "signal") expect(kinds[i - 1]).toBe("measurement");
    }
    // vocabulary 0.2 + greppable 0.2 (file readings) + purposeful 0.2 and complex 0.8
    // firing on both elements
    expect(events.filter((e) => e.type === "signal")).toHaveLength(6);
  });

  test("--disable removes rules by name before measuring", async () => {
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
          "is_function_srp",
          "is_readability",
        ],
        classifier: loggingClassifier({ is_name_purposeful: 0.7 }, log),
      }),
    );
    // purposeful targets definitions: one classification call, no whole-content call
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0]!.questions).toHaveLength(2);
    for (const key of log.calls[0]!.questions) {
      expect(key).toMatch(/^L\d+(-L\d+)?$/); // single rule -> bare unit-id keys
    }
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(2);
  });

  test("diff input splits into per-file units with calibrated state", async () => {
    const states: unknown[] = [];
    const inner = classifierWith({
      is_name_purposeful: 0.7,
      is_vocabulary_consistent: 0.9,
      is_greppable: 0.8,
      is_cognitively_complex: 0.3,
    });
    const classifier: Classifier = async (state, questions) => {
      states.push(state);
      return inner(state, questions);
    };
    const events = await drain(
      lint({
        config: baseConfig,
        input: "tests/fixtures/sample.diff",
        inputType: "diff",
        classifier,
      }),
    );
    // diff units map to no element units (quick path): only the whole-unit call runs per file
    // (2 rules x 2 files); no sweep, no whole-file element judgment
    const paths = [...new Set(states.map((s) => (s as { path: string }).path))];
    expect(paths).toEqual([
      "src/tui/components/overlays/box.ts",
      "src/tui/components/overlays/help.ts",
    ]); // deleted + binary skipped
    expect((states[0] as { commit_message: string | null }).commit_message).toBeNull();
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(4);
  });

  test("per-unit failure becomes a streamed error; the run continues", async () => {
    const classifier: Classifier = async (state, questions) => {
      if (state.path === FILE)
        throw new MeasureError("JEV_UNAVAILABLE", state.path, "first unit hiccup");
      return classifierWith({
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
        classifier,
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
    const classifier: Classifier = async (state) => {
      calls++;
      throw new MeasureError("JEV_AUTH", state.path, "jev rejected the API key");
    };
    const events = await drain(
      lint({
        config: baseConfig,
        input: [
          "tests/fixtures/sample-file.ts",
          "tests/fixtures/sample-dir/good.ts",
          "tests/fixtures/sample-dir/sub/more.ts",
        ],
        classifier,
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
      await drain(lint({ config: baseConfig, input: "", classifier: classifierWith({}) }));
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
        classifier: classifierWith({
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
    expect(inputs).toEqual(new Set(["good.ts", "good.ts#L2", "good.ts#L4-L6"]));
  });

  test("custom rule set (selection = the rule list itself)", async () => {
    const only: Rule[] = [defaultRules.is_name_purposeful!];
    const config = defineConfig({ input: "", rules: [only[0]!] });
    const events = await drain(
      lint({
        config,
        input: FILE,
        classifier: classifierWith({ is_name_purposeful: 0.7 }),
      }),
    );
    // definitions target: 2 sweep questions, no candidates at 0.7
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(2);
  });
});

describe("collectReport", () => {
  test("drains the stream into measurements/signals/errors", async () => {
    const report = await collectReport(
      lint({
        config: baseConfig,
        input: FILE,
        classifier: classifierWith({
          is_name_purposeful: 0.3,
          is_vocabulary_consistent: 0.9,
          is_greppable: 0.8,
          is_cognitively_complex: 0.3,
        }),
      }),
    );
    expect(report.measurements).toHaveLength(16);
    expect(report.signals).toHaveLength(2);
    expect(report.errors).toHaveLength(0);
  });
});
