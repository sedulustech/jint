import { afterAll, describe, test, expect } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { defaultConfig } from "../config/load.ts";
import { lint, collectReport } from "../core/lint.ts";
import { renderJson } from "../core/output/json.ts";
import { defaultRules } from "../core/sensors/defaults.ts";
import {
  ClassifyError,
  SetupError,
  type AnyState,
  type Classifier,
  type LintEvent,
  type Rule,
} from "../core/types.ts";

const baseConfig = {
  ...defaultConfig(),
  input: "",
  exclude: [] as string[],
};

const FILE = "tests/fixtures/sample-file.ts"; // two definitions, no comments: d0, d1

afterAll(() => {
  rmSync("tmp/lint-retention-test", { recursive: true, force: true });
  rmSync("tmp/lint-walk-order-test", { recursive: true, force: true });
});

/**
 * The full rule set at handle-silent readings; tests spread over it so each case names only what it
 * asserts about. Every unspecified rule answers silent in both regimes.
 */
const SILENT = {
  is_name_purposeful: 0.9,
  is_vocabulary_consistent: 0.9,
  is_naming_convention_consistent: 0.9,
  is_greppable: 0.9,
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
        JSON.stringify({ isElementCall: "source" in state, keys: Object.keys(questions) }),
      );
    return inner(state, questions);
  };
}

const isElementCall = (state: AnyState): boolean => "source" in state;

const COMMENT_SENSORS = [
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
  // one element per call: the element's rules batch inside the call under bare rule-name keys
  const elementCalls = log.calls.filter((c) => isElementCall(c.state));
  expect(elementCalls.length).toBeGreaterThan(0);
  for (const c of elementCalls) {
    const source = (c.state as { source: string }).source;
    const isCommentElement = !source.includes("export ");
    for (const rule of c.questions) {
      if (COMMENT_SENSORS.includes(rule)) {
        // comment-family rules may judge comment elements and definitions WITH attached docblocks,
        // but never a bare definition (nothing to classify)
        expect(isCommentElement || source.includes("//")).toBe(true);
      }
      if (DEFINITION_SENSORS.includes(rule)) {
        expect(isCommentElement).toBe(false);
      }
    }
  }
});

async function drain(events: AsyncIterable<LintEvent>): Promise<LintEvent[]> {
  const out: LintEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("lint — classification shape", () => {
  test("one element-classification call per element (bare rule-name keys); files-target call separate", async () => {
    const log: CallLog = { calls: [] };
    await drain(lint({ config: baseConfig, input: FILE, classifier: loggingClassifier({}, log) }));
    // one call per element, state = {path, source} - the array matrix state is banned (averages)
    const elementCalls = log.calls.filter((c) => isElementCall(c.state));
    expect(elementCalls).toHaveLength(2); // two definitions: addSeconds, formatDuration
    const sources = elementCalls.map((c) => (c.state as { path: string; source: string }).source);
    expect(sources[0]).toContain("addSeconds");
    expect(sources[1]).toContain("formatDuration");
    for (const c of elementCalls) {
      for (const state of [c.state]) {
        expect((state as { path: string }).path).toBe(FILE);
      }
    }
    // per (element, target-matched rule): L2-L4 carries the module docblock -> 8 rules,
    // L6-L11 is a bare definition -> 4 definition-target rules (design 7.7 targeting);
    // question keys inside a call are bare rule names (one element per call, no ambiguity)
    // docblock-carrying function definition: 9 rules (4 comment + 4 definition + srp);
    // bare function definition: 6 rules (4 definition-target + srp + will_error_lose_cause)
    const counts = elementCalls.map((c) => c.questions.length).sort((a, b) => a - b);
    expect(counts).toEqual([6, 9]);
    const withPurposeful = elementCalls.find((c) => c.questions.includes("is_name_purposeful"))!;
    const withComplex = elementCalls.find((c) => c.questions.includes("is_cognitively_complex"))!;
    expect(withPurposeful).toBeDefined();
    expect(withComplex).toBeDefined();
    // criteria-as-rule: instructions is the task sentence, criteria is the rule
    // (noul questions carry their rule's question; choice questions carry their own instructions)
    for (const [, spec] of Object.entries(elementCalls[0]!.specs)) {
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
    const whole = log.calls.filter((c) => !isElementCall(c.state));
    expect(whole.length).toBeGreaterThanOrEqual(1);
    // whole-content call questions are keyed "<rule> in <file id>" (the content hash)
    for (const key of whole[0]!.questions) {
      expect(key).toMatch(
        /^is_(vocabulary_consistent|greppable|filename_fitting) in L\d+(-L\d+)?$/,
      );
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
      expect(isElementCall(log.calls[0]!.state)).toBe(false);
      const measurements = events.filter((e) => e.type === "measurement");
      expect(measurements).toHaveLength(3); // whole-unit rules only
      const errors = events.filter(
        (e): e is Extract<LintEvent, { type: "error" }> => e.type === "error",
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error.code).toBe("WALK_FAILED");
      expect(errors[0]!.error.message).toContain("cannot map to elements");
    } finally {
      const shell = Bun.spawnSync(["rm", empty]);
      expect(shell.exitCode).toBe(0);
    }
  });

  test("classification never hands a whole-file element to any target, functions included", async () => {
    const log: CallLog = { calls: [] };
    await drain(lint({ config: baseConfig, input: FILE, classifier: loggingClassifier({}, log) }));
    const elementCalls = log.calls.filter((c) => isElementCall(c.state));
    expect(elementCalls.length).toBeGreaterThan(0);
    const src = await Bun.file(FILE).text();
    for (const c of elementCalls) {
      // no element IS the whole file - targets route over elements, never a file-shaped element
      expect((c.state as { source: string }).source).not.toBe(src);
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
      const sweepCalls = calls.filter((c) => isElementCall((c as { state: AnyState }).state));
      expect(sweepCalls).toHaveLength(0);
    } finally {
      const shell = Bun.spawnSync(["rm", empty]);
      expect(shell.exitCode).toBe(0);
    }
  });
});

describe("lint", () => {
  afterAll(() => rmSync("tests/fixtures/order-test", { recursive: true, force: true }));

  test("concurrent completion reports deterministically: the full document is byte-identical", async () => {
    // ONE file, 8 function elements, one rule firing on all: findings tie on (input, rule), so
    // only the span key makes the sort total. The mock completes elements in REVERSE order with
    // RANDOM jitter (different every run, so an unsorted implementation cannot pass by luck).
    // The contract is at the serialized boundary: the ENTIRE report string is compared, not a
    // projection of one array.
    const dir = "tests/fixtures/order-test";
    mkdirSync(dir, { recursive: true });
    const lines = Array.from(
      { length: 8 },
      (_, i) => `export function f${i}(): number { return ${i}; }`,
    );
    writeFileSync(`${dir}/elements.ts`, lines.join("\n") + "\n");
    const documentOf = async (): Promise<string> => {
      const report = await collectReport(
        lint({
          config: { ...baseConfig, input: "" },
          input: `${dir}/elements.ts`,
          classifier: async (state, questions) => {
            const element = Number(/f(\d+)/.exec(state.path)?.[1] ?? 0);
            await new Promise((r) => setTimeout(r, (7 - element) * 6 + Math.random() * 6));
            return Object.fromEntries(Object.keys(questions).map((k) => [k, 0.3]));
          },
        }),
      );
      expect(report.measurements.length).toBeGreaterThanOrEqual(8);
      return JSON.stringify(report);
    };
    const first = await documentOf();
    const second = await documentOf();
    expect(first).toBe(second);
    // and the findings within it are span-ordered, not just input-ordered
    const findings = JSON.parse(first).findings as Array<{
      input: string;
      location?: { span: { startByte: number } };
    }>;
    const starts = findings.map((f) => f.location?.span.startByte ?? -1);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    rmSync(dir, { recursive: true, force: true });
  });

  test("a hung call times out into a per-element JEV_TIMEOUT error; the run continues", async () => {
    const dir = "tests/fixtures/timeout-test";
    mkdirSync(dir, { recursive: true });
    const lines = Array.from(
      { length: 3 },
      (_, i) => `export function f${i}(): number { return ${i}; }`,
    );
    writeFileSync(`${dir}/elements.ts`, lines.join("\n") + "\n");
    const report = await collectReport(
      lint({
        config: { ...baseConfig, input: "" },
        input: `${dir}/elements.ts`,
        timeout: 0.2, // seconds: the hung element fails fast, the others never wait for it
        classifier: async (state, questions) => {
          if ("source" in state && state.source.includes("f1()")) {
            await new Promise(() => {}); // hung request: never settles
          }
          await new Promise((r) => setTimeout(r, 2));
          return Object.fromEntries(Object.keys(questions).map((k) => [k, 0.3]));
        },
      }),
    );
    // one hung call = one per-element error, the run continues around it
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.code).toBe("JEV_TIMEOUT");
    expect(report.errors[0]?.input).toContain("#L2");
    expect(report.measurements.length).toBeGreaterThanOrEqual(2);
    rmSync(dir, { recursive: true, force: true });
  });

  test("per-rule scoping (issue 008): scoped-out elements cost zero calls and are noted", async () => {
    const scopedRule: Rule = {
      name: "is_scope_probe",
      criteria: { true: "t", false: "f" },
      target: "definitions",
      handle: () => null,
      exclude: ["tests/**"],
    };
    const calls: string[] = [];
    const classifier: Classifier = async (state, questions) => {
      calls.push(state.path);
      return Object.fromEntries(Object.keys(questions).map((k) => [k, 0.5]));
    };
    const report = await collectReport(
      lint({
        config: { ...baseConfig, input: "", rules: [scopedRule] },
        input: FILE, // under tests/ — the exclude glob scopes the rule out entirely
        classifier,
      }),
    );
    // zero jev calls: scoping filters at element selection, before rule resolution
    expect(calls).toHaveLength(0);
    expect(report.measurements).toHaveLength(0);
    expect(report.findings).toHaveLength(0);
    // the gap is signal, not silence: ONE aggregated note per unit names the rule and the count
    expect(report.notes).toHaveLength(1);
    expect(report.notes[0]).toContain("scope excluded");
    expect(report.notes[0]).toContain("rule 'is_scope_probe' scope excluded 2 element(s)");
    // the signal survives the machine boundary too (review 396888e finding 1): --json carries it
    expect(JSON.parse(renderJson(report)).notes).toEqual(report.notes);
  });

  test("scoping matrix through the pipeline: include/exclude/both compose with global exclude", async () => {
    // A dir fixture: the walk yields relative paths (keep.ts, drop.ts), so all three filtering
    // layers are exercisable — global exclude (walk), per-rule include, per-rule exclude.
    const dir = "tests/fixtures/scope-test";
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/keep.ts`, "export function keep(): number { return 1; }\n");
    writeFileSync(`${dir}/drop.ts`, "export function drop(): number { return 2; }\n");
    let probe = 0;
    const mk = (scope: { include?: string[]; exclude?: string[] }): Rule => ({
      name: `is_scope_probe_${probe++}`,
      criteria: { true: "t", false: "f" },
      target: "definitions",
      handle: () => null,
      ...scope,
    });
    const calls = async (config: Record<string, unknown>, only?: string[]): Promise<number> => {
      let n = 0;
      await collectReport(
        lint({
          config: { rules: [], exclude: [], ...(config as object) } as never,
          only,
          input: dir,
          classifier: async (state, questions) => {
            n += Object.keys(questions).length;
            return Object.fromEntries(Object.keys(questions).map((k) => [k, 0.5]));
          },
        }),
      );
      return n;
    };
    // neither key: every element measured (2 files x 1 rule)
    expect(await calls({ rules: [mk({})] })).toBe(2);
    // include only: the glob picks the subset
    expect(await calls({ rules: [mk({ include: ["**/keep.ts"] })] })).toBe(1);
    expect(await calls({ rules: [mk({ include: ["**/drop.ts"] })] })).toBe(1);
    // exclude only: subtracts the subset
    expect(await calls({ rules: [mk({ exclude: ["**/drop.ts"] })] })).toBe(1);
    // both: include matches both files, exclude subtracts one — exclude wins on the overlap
    expect(await calls({ rules: [mk({ include: ["**/*.ts"], exclude: ["**/drop.ts"] })] })).toBe(1);
    // the SAME pattern in both lists: legal, measures nothing, and noted
    const report = await collectReport(
      lint({
        config: {
          input: "",
          exclude: [],
          rules: [mk({ include: ["**/*.ts"], exclude: ["**/*.ts"] })],
        },
        input: dir,
        classifier: async (state, questions) =>
          Object.fromEntries(Object.keys(questions).map((k) => [k, 0.5])),
      }),
    );
    expect(report.measurements).toHaveLength(0);
    // layer 1 (global config exclude) removes the UNIT at the walk: zero calls even with a rule
    // whose include matches that file
    expect(
      await calls({
        exclude: ["**/drop.ts"],
        rules: [mk({ include: ["**/drop.ts"] })],
      }),
    ).toBe(0);
    // --rule selection composes: only the selected rule runs, still honoring its scope
    const scoped = mk({ include: ["**/drop.ts"] });
    const plain = mk({});
    expect(await calls({ rules: [scoped, plain] }, [scoped.name])).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  test("streams measurement per (rule, unit), finding only when the handle fires", async () => {
    const events = await drain(
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
    const measurements = events.filter((e) => e.type === "measurement");
    const findings = events.filter((e) => e.type === "finding");
    // file call 3 (promoted is_filename_fitting) + element classification 15 (8 docblock + 4 bare definitions + 3 functions)
    expect(measurements).toHaveLength(18);
    // purposeful 0.3 fires (warn under the re-anchored tiers, issue 001) on BOTH elements -
    // no aggregation, no candidacy
    expect(findings).toHaveLength(2);
    expect(findings.map((s) => s.finding.input)).toEqual([FILE + "#L2-L4", FILE + "#L6-L11"]);
    for (const s of findings) {
      expect(s.finding).toEqual({
        rule: "is_name_purposeful",
        input: s.finding.input,
        value: 0.3,
        severity: "warn",
        location: { input: s.finding.input, span: expect.any(Object) },
      });
    }
  });

  test("single pass: every measurement runs its handle, each finding follows its measurement", async () => {
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
      // no aggregation: a finding directly follows its own measurement
      if (kinds[i] === "finding") expect(kinds[i - 1]).toBe("measurement");
    }
    // vocabulary 0.2 + greppable 0.2 (file readings) + purposeful 0.2 and complex 0.8
    // firing on both elements
    expect(events.filter((e) => e.type === "finding")).toHaveLength(6);
  });

  test("--disable removes rules by name before classifying", async () => {
    const log: CallLog = { calls: [] };
    const events = await drain(
      lint({
        config: baseConfig,
        input: FILE,
        disable: [
          "is_comment_narration",
          "is_comment_patching_readability",
          "will_comment_drift",
          "is_cognitively_complex",
          "is_vocabulary_consistent",
          "is_naming_convention_consistent",
          "is_greppable",
          "is_function_srp",
          "is_readable",
          "is_filename_fitting",
        ],
        classifier: loggingClassifier({ is_name_purposeful: 0.7 }, log),
      }),
    );
    // purposeful targets definitions: one classification call per element, no whole-content call
    expect(log.calls).toHaveLength(2);
    for (const c of log.calls) {
      expect(c.questions).toEqual(["is_name_purposeful", "will_error_lose_cause"]); // bare rule-name keys, one element per call
    }
    // 2 function elements x 2 remaining rules (is_name_purposeful + will_error_lose_cause)
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(4);
  });

  test("the changed list is the input: selection + the missing-entry note (never silence)", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync("tmp/changed-list-test", { recursive: true });
    writeFileSync(
      "tmp/changed-list-test/list.txt",
      FILE + "\nno/such/file.ts\n" + FILE + "\n", // duplicate dedupes; missing noted
    );
    const events = await drain(
      lint({
        config: { ...baseConfig, input: "" },
        changed: "tmp/changed-list-test/list.txt",
        classifier: classifierWith({
          is_name_purposeful: 0.7,
          is_vocabulary_consistent: 0.9,
          is_greppable: 0.8,
          is_cognitively_complex: 0.3,
        }),
      }),
    );
    const notes = events
      .filter((e): e is Extract<LintEvent, { type: "note" }> => e.type === "note")
      .map((e) => e.note);
    expect(
      notes.some((n) => n.includes("not found in the walk") && n.includes("no/such/file.ts")),
    ).toBe(true);
    // the subject came from the list: only the listed file was judged
    const inputs = new Set(
      events
        .filter((e): e is Extract<LintEvent, { type: "measurement" }> => e.type === "measurement")
        .map((e) => e.measurement.input.split("#")[0]),
    );
    expect([...inputs]).toEqual([FILE]);
  });

  test("per-unit failure becomes a streamed error; the run continues", async () => {
    const classifier: Classifier = async (state, questions) => {
      if (state.path === FILE)
        throw new ClassifyError("JEV_UNAVAILABLE", state.path, "first unit hiccup");
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
    // the failed file's calls (whole-content + one call per element) surface an error
    expect(errors).toHaveLength(3);
    expect(errors[0]!.error.code).toBe("JEV_UNAVAILABLE");
    // second unit: 3 file + 7 (comment element) + 6 (clampToLimit, function element);
    // SMALL_LIMIT is a binding — no functions-target (or other element) measurements
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(16);
  });

  test("JEV_AUTH aborts the run after surfacing the errors (bounded, no hammering)", async () => {
    let calls = 0;
    const classifier: Classifier = async (state) => {
      calls++;
      throw new ClassifyError("JEV_AUTH", state.path, "jev rejected the API key");
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
    const config = { ...defaultConfig(), input: "", rules: only };
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
  test("drains the stream into measurements/findings/errors", async () => {
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
    expect(report.measurements).toHaveLength(18);
    expect(report.findings).toHaveLength(2);
    expect(report.errors).toHaveLength(0);
  });
});

describe("lint — unknown rule names", () => {
  test("--rule with an exact known name runs (regression guard)", async () => {
    const events = await drain(
      lint({
        config: baseConfig,
        input: "tests/fixtures/sample-file.ts",
        only: ["is_greppable"],
        classifier: classifierWith({}),
      }),
    );
    expect(events.some((e) => e.type === "measurement")).toBe(true);
  });

  test("unknown --rule throws SetupError CONFIG_INVALID, not a silent empty run", async () => {
    expect(
      drain(
        lint({
          config: baseConfig,
          input: "tests/fixtures/sample-file.ts",
          only: ["nonexistent"],
          classifier: classifierWith({}),
        }),
      ),
    ).rejects.toMatchObject({ name: "SetupError", code: "CONFIG_INVALID" });
  });

  test("a close miss suggests the nearest known rule name", async () => {
    await expect(
      drain(
        lint({
          config: baseConfig,
          input: "tests/fixtures/sample-file.ts",
          only: ["is_greppable_x"],
          classifier: classifierWith({}),
        }),
      ),
    ).rejects.toThrow(/unknown rule "is_greppable_x" — did you mean: is_greppable\?/);
  });
});

describe("lint — tsRules content retention (the logical content-drop)", () => {
  const TS_DIR = "tmp/lint-retention-test";
  const RULE_PATH = TS_DIR + "/comment-rule.ts";
  // Targets ONLY good.ts's elements: sample-file.ts has zero selected targets.
  const RULE_SOURCE = [
    'import { defineConfig } from "jint:sdk";',
    "export default defineConfig({",
    "  rules: [{",
    '    name: "ts_retention_probe",',
    "    target: (elements) => elements.filter((e) => e.path.endsWith('good.ts')),",
    "    classify: (self) => ({",
    '      instructions: "i",',
    '      criteria: { true: "t", false: "f" },',
    "      state: { source: self.source },",
    "    }),",
    '    handle: { fires_when: "true", warn_at: 0.1, error_at: 0.2 },',
    "  }],",
    "});",
  ].join("\n");
  const FILES_RULE = {
    name: "is_files_retention_probe",
    kind: "noul" as const,
    criteria: { true: "t", false: "f" },
    target: "files" as const,
    handle: null,
  };
  const GOOD = "tests/fixtures/sample-dir/good.ts";
  const isWholeFileCall = (state: AnyState): boolean =>
    "content" in state && typeof state.content === "string";

  const writeRule = (): void => {
    mkdirSync(TS_DIR, { recursive: true });
    writeFileSync(RULE_PATH, RULE_SOURCE);
  };

  test("a files-target JSON rule retains EVERY file's content even when TS rules target only one file", async () => {
    writeRule();
    const log: CallLog = { calls: [] };
    await drain(
      lint({
        config: { ...baseConfig, rules: [FILES_RULE as never], tsRules: [RULE_PATH] },
        input: [FILE, GOOD],
        classifier: loggingClassifier(
          { is_files_retention_probe: 0.9, ts_retention_probe: 0.9 },
          log,
        ),
      }),
    );
    const whole = log.calls.filter((c) => isWholeFileCall(c.state));
    // The retention guard fired: both files judged whole, full content intact.
    expect(whole.map((c) => (c.state as { path: string }).path).sort()).toEqual(
      [FILE, GOOD].sort(),
    );
    const sample = whole.find((c) => (c.state as { path: string }).path === FILE)!;
    expect((sample.state as { content: string }).content.length).toBeGreaterThan(0);
  });

  test("zero-target files are logically dropped: no whole-file call, but element classification still runs", async () => {
    writeRule();
    const log: CallLog = { calls: [] };
    const events = await drain(
      lint({
        // No files-target JSON rule: the drop path is live for the un-targeted file. One
        // definitions-target JSON rule keeps the JSON element tier running for both files.
        config: {
          ...baseConfig,
          rules: [
            {
              name: "is_defs_retention_probe",
              kind: "noul" as const,
              criteria: { true: "t", false: "f" },
              target: "definitions" as const,
              handle: null,
            } as never,
          ],
          tsRules: [RULE_PATH],
        },
        input: [FILE, GOOD],
        classifier: loggingClassifier({ ts_retention_probe: 0.9 }, log),
      }),
    );
    // Nothing judged whole (no files rule, so nothing to retain content FOR).
    expect(log.calls.some((c) => isWholeFileCall(c.state))).toBe(false);
    // The drop is LOGICAL: sample-file.ts's inventory is retained, so its elements still classify.
    const sampleElementCalls = log.calls.filter(
      (c) => isElementCall(c.state) && (c.state as { path: string }).path === FILE,
    );
    expect(sampleElementCalls.length).toBeGreaterThan(0);
    // The TS rule measured ONLY on its targets (both in good.ts; nothing from sample-file.ts).
    const tsMeasurements = events.filter(
      (e) => e.type === "measurement" && e.measurement.rule === "ts_retention_probe",
    );
    expect(tsMeasurements).toHaveLength(2);
    expect(
      tsMeasurements.every(
        (e) => e.type === "measurement" && e.measurement.input.includes("good.ts"),
      ),
    ).toBe(true);
  });
});

describe("lint — walk-first yield ordering (pure JSON)", () => {
  const ORDER_DIR = "tmp/lint-walk-order-test";
  const BROKEN = ORDER_DIR + "/empty.ts"; // parseable but zero elements -> WALK_FAILED
  const FILES_RULE = {
    name: "is_files_order_probe",
    kind: "noul" as const,
    criteria: { true: "t", false: "f" },
    target: "files" as const,
    handle: null,
  };

  test("a WALK_FAILED streams in-band, in unit order, and the run continues to classification", async () => {
    mkdirSync(ORDER_DIR, { recursive: true });
    writeFileSync(BROKEN, ";");
    const events = await drain(
      lint({
        config: { ...baseConfig, rules: [FILES_RULE as never] },
        // The broken unit is FIRST: its events (whole-file call + WALK_FAILED) yield before the
        // next unit's classification events (per-wave, per-unit order).
        input: [BROKEN, FILE],
        classifier: classifierWith({ is_files_order_probe: 0.9 }),
      }),
    );
    const walkFailedIndex = events.findIndex(
      (e) => e.type === "error" && e.error.code === "WALK_FAILED",
    );
    expect(walkFailedIndex).toBeGreaterThanOrEqual(0);
    // The failed unit's whole-file measurement streamed BEFORE its WALK_FAILED (the walk failure
    // never preempts or aborts the unit's own classification), and the next unit still classified.
    const measurements = events.filter((e) => e.type === "measurement");
    expect(measurements.length).toBeGreaterThan(1);
    expect(
      events.findIndex(
        (e) => e.type === "measurement" && e.measurement.input.includes("sample-file"),
      ),
    ).toBeGreaterThan(walkFailedIndex);
  });
});

describe("lint — str unit is its own inventory", () => {
  const classifier: Classifier = async (_state, questions) =>
    Object.fromEntries(Object.keys(questions).map((k) => [k, 0.5]));

  test("any rule judges the str unit whole, no grammar, no WALK_FAILED", async () => {
    // an element-target rule over a str unit: the whole input is the element, no mapping
    const events = await drain(
      lint({
        config: baseConfig,
        str: { content: "const x = 1;\n" },
        only: ["is_function_srp"],
        classifier,
      }),
    );
    const errors = events.filter(
      (e): e is Extract<LintEvent, { type: "error" }> => e.type === "error",
    );
    expect(errors).toHaveLength(0);
    const measurements = events.filter((e) => e.type === "measurement");
    expect(measurements).toHaveLength(1);
    expect(measurements[0]!.measurement.stage).toBe("file");
  });

  test("no WALK_FAILED on the str path even with --language; extensionless FILES reject upstream", async () => {
    // str: no WALK_FAILED, so no remedy — with or without --language
    const strEvents = await drain(
      lint({
        config: baseConfig,
        str: { content: "const x = 1;\n" },
        language: "typescript",
        classifier,
      }),
    );
    expect(strEvents.filter((e) => e.type === "error")).toHaveLength(0);
    // an extensionless FILE is not a WALK_FAILED path at all: it is rejected as not-source
    // before any unit exists (the remedy names the str noun for raw text)
    const dir = `/tmp/jint-extless-${Date.now()}`;
    await Bun.write(`${dir}/snippet`, "const x = 1;\n");
    await expect(
      drain(lint({ config: baseConfig, input: `${dir}/snippet`, classifier })),
    ).rejects.toMatchObject({ name: "SetupError", code: "NOT_SOURCE" });
  });
});
