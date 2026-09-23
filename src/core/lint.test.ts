import { describe, test, expect } from "bun:test";
import { defineConfig } from "../config/define.ts";
import { lint, collectReport } from "../core/lint.ts";
import { UNIT_TASK } from "../core/sensors/classify.ts";
import { defaultRules } from "../core/sensors/defaults.ts";
import {
  RequestError,
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
 * Same fixed per-rule answers for every call, keyed by the asked question id (sweep questions are
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

/** A classifier that records every call (state shape + question keys) — funnel-shape assertions. */
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

test("sweep respects rule targets: comment rules never classifier bare definitions, definition rules never classifier comment elements", async () => {
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
      // comment-family rules may classifier comment elements and definitions WITH attached docblocks,
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

describe("lint — funnel shape", () => {
  test("one sweep call per file with array state + documented noul questions; files-target call separate", async () => {
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
    // per (element, target-matched rule): L2-L4 carries the module docblock -> 7 rules,
    // L6-L11 is a bare definition -> 3 definition-target rules (design 7.7 targeting)
    expect(sweep.questions).toHaveLength(12);
    expect(sweep.questions).toContain(`is_name_purposeful in ${blockIds[0]}`);
    expect(sweep.questions).toContain(`is_cognitively_complex in ${blockIds[1]}`);
    // criteria-as-rule: instructions maps the unit id to the task, criteria is the rule
    for (const [key, spec] of Object.entries(sweep.specs)) {
      const s = spec as {
        type: string;
        instructions: unknown;
        criteria?: { true: string; false: string };
      };
      expect(s.type).toBe("noul");
      const unitId = key.slice(key.indexOf(" in ") + 4);
      expect(s.instructions).toEqual({ [unitId]: UNIT_TASK });
      expect(s.criteria).toBeDefined();
      // criteria is the rule's actual rule, never the generic form
      expect(s.criteria!.true).not.toContain("described property");
    }
    // the files-target rules keep their own whole-content call
    const whole = log.calls.filter((c) => !isSweep(c.state));
    expect(whole.length).toBeGreaterThanOrEqual(1);
    // whole-content call questions are keyed "<rule> in <file id>" (the content hash)
    for (const key of whole[0]!.questions) {
      expect(key).toMatch(/^is_(vocabulary_consistent|greppable) in L\d+(-L\d+)?$/);
    }
  });

  test("isolated confirm calls happen only for sweep candidates", async () => {
    const log: CallLog = { calls: [] };
    // purposeful 0.3 sweeps below 0.5 -> both elements candidates; complex 0.3 stays quiet
    await drain(
      lint({
        config: baseConfig,
        input: FILE,
        classifier: loggingClassifier(
          { is_name_purposeful: 0.3, is_cognitively_complex: 0.3 },
          log,
        ),
      }),
    );
    // isolated confirm calls: whole-content-shaped states that are NOT the file itself
    const source = await Bun.file(FILE).text();
    const leafCalls = log.calls.filter(
      (c) => !isSweep(c.state) && "content" in c.state && c.state.content !== source,
    );
    expect(leafCalls).toHaveLength(2); // one per flagged element, no others
    for (const c of leafCalls) {
      // confirm questions are keyed "<rule> in <element wire id>" — the same LOC id the sweep used
      expect(c.questions).toContain(
        `${"is_name_purposeful"} in ${c.questions[0]!.split(" in ")[1]}`,
      );
      expect(c.questions.length).toBeGreaterThanOrEqual(3);
      for (const key of c.questions) {
        expect(key).toMatch(/^\S+ in L\d+(-L\d+)?$/);
      }
    }
  });

  test("confirmed signals aggregate max over elements (high=bad) and carry block locations", async () => {
    // complex sweeps above 0.55 -> both elements; confirmed per block: 0.5 and 0.9 -> max 0.9.
    // The isolated calls ask plain rule names, so block identity routes on the element content.
    const classifier: Classifier = async (state, questions) => {
      const sweep = "elements" in state;
      const element = !sweep && "content" in state && state.content.includes("formatDuration");
      const out: Record<string, number> = {};
      for (const key of Object.keys(questions)) {
        const rule = sensorOf(key);
        let value = SILENT[rule as keyof typeof SILENT];
        if (rule === "is_cognitively_complex") value = sweep ? 0.9 : element ? 0.9 : 0.5;
        out[key] = value;
      }
      return out;
    };
    const events = await drain(lint({ config: baseConfig, input: FILE, classifier }));
    const signals = events.filter((e) => e.type === "signal");
    expect(signals).toHaveLength(1);
    const s = signals[0]!.signal as unknown as Record<string, unknown>;
    expect(s.rule).toBe("is_cognitively_complex");
    expect(s.value).toBe(0.9);
    expect(s.severity).toBe("error");
    expect(s.input).toBe(FILE + "#L6-L11"); // the extreme element's location
    expect(s.location).toEqual({ input: FILE + "#L6-L11", span: expect.any(Object) });
  });

  test("high=good rules aggregate min over elements", async () => {
    // purposeful 0.3 sweeps both elements; confirmed 0.3 everywhere -> min, one signal
    const events = await drain(
      lint({
        config: baseConfig,
        input: FILE,
        classifier: classifierWith({ is_name_purposeful: 0.3 }),
      }),
    );
    const signals = events.filter((e) => e.type === "signal");
    expect(signals).toHaveLength(1);
    const s = signals[0]!.signal as unknown as Record<string, unknown>;
    expect(s.value).toBe(0.3);
    expect(s.severity).toBe("error");
    expect(s.input).toBe(FILE + "#L2-L4");
  });

  test("sweep flags are not verdicts: signals come only from the confirm regime", async () => {
    // sweep 0.49 crosses the 0.50 anchor (candidate) while the confirm reading 0.7 clears the
    // handle: if the sweep reading could fire a handle, a signal would exist
    const events = await drain(
      lint({
        config: baseConfig,
        input: FILE,
        classifier: async (state, questions) => {
          const sweep = "elements" in state;
          const out: Record<string, number> = {};
          for (const key of Object.keys(questions)) {
            const rule = sensorOf(key);
            out[key] =
              rule === "is_name_purposeful"
                ? sweep
                  ? 0.49
                  : 0.7
                : (SILENT[rule as keyof typeof SILENT] ?? 0.5);
          }
          return out;
        },
      }),
    );
    expect(events.filter((e) => e.type === "signal")).toHaveLength(0);
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
      const degradations = events.filter(
        (e): e is Extract<LintEvent, { type: "degradation" }> => e.type === "degradation",
      );
      expect(degradations).toHaveLength(1);
      expect(degradations[0]!.degradation.code).toBe("MAPPING_DEGRADED");
      expect(degradations[0]!.degradation.message).toContain("not swept");
    } finally {
      const shell = Bun.spawnSync(["rm", empty]);
      expect(shell.exitCode).toBe(0);
    }
  });

  test("sweep never hands a whole-file element to any target, functions included", async () => {
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

  test("empty sweep state (no elements) produces no questions and no crash", async () => {
    const { classifyFile } = await import("./sensors/funnel.ts");
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
      // files-target call only; the sweep is skipped entirely (empty elements -> early return)
      expect(calls).toHaveLength(1);
      expect(result.confirmed).toEqual([]);
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
    // file call 2 + sweep 10 (7 docblock element + 3 bare element) + confirm 10 (both flagged by 0.3)
    expect(measurements).toHaveLength(26);
    // purposeful 0.3 -> one aggregated error at the extreme element; business_context at 1.0
    // never fires (measurement-only in v0)
    expect(signals).toHaveLength(1);
    expect(signals[0]!.signal).toEqual({
      rule: "is_name_purposeful",
      input: FILE + "#L2-L4",
      value: 0.3,
      severity: "error",
      location: { input: FILE + "#L2-L4", span: expect.any(Object) },
    });
  });

  test("every measurement precedes its signal (two-stage model)", async () => {
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
      // aggregated confirm signals batch at the end of a file, so pair loosely:
      // a signal must be preceded by at least one measurement of the same file
      if (kinds[i] === "signal") expect(kinds.slice(0, i).includes("measurement")).toBe(true);
    }
    // vocabulary 0.2 + greppable 0.2 (file call) + complex 0.8 (max over two confirmed
    // elements, error) + purposeful 0.2 (min, error)
    expect(events.filter((e) => e.type === "signal")).toHaveLength(4);
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
        ],
        classifier: loggingClassifier({ is_name_purposeful: 0.7 }, log),
      }),
    );
    // purposeful targets definitions: sweep only, no whole-content call, no confirm
    // (0.7 is above the sweep anchor)
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
        throw new RequestError("JEV_UNAVAILABLE", state.path, "first unit hiccup");
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
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(14); // second unit: 2 file + 12 sweep
  });

  test("JEV_AUTH aborts the run after surfacing the errors (bounded, no hammering)", async () => {
    let calls = 0;
    const classifier: Classifier = async (state) => {
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
  test("drains the stream into measurements/signals/errors/degradations", async () => {
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
    expect(report.measurements).toHaveLength(26);
    expect(report.signals).toHaveLength(1);
    expect(report.errors).toHaveLength(0);
    expect(report.degradations).toHaveLength(0);
  });
});
