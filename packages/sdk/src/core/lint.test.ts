import { afterAll, describe, test, expect } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { ruleTargets } from "@jint/contract";
import { compileRule } from "../config/load.ts";
import { lint, collectReport } from "./lint.ts";
import { renderJson } from "./output/json.ts";
import {
  ClassifyError,
  SetupError,
  type AnyState,
  type ClassifiedAnswer,
  type Classifier,
  type LintEvent,
  type Rule,
} from "./types.ts";

/**
 * Synthetic rule data, one per kind: schema-shaped entries the engine tests compose from. The
 * engine's behavior (stream order, finding-follows-measurement, aggregation, per-unit failures) is
 * inert to defaults edits - a rule-data change in @jint/defaults cannot move these assertions,
 * because every fixture here derives from the data this file declares.
 */
const NOUL_DATA = {
  name: "probe_noul",
  instructions: "Is this unit what its name promises?",
  criteria: { true: "It is what the name promises.", false: "It is something else." },
  target: "files",
  handle: { warn: { greater_than: 0.9 } }, // fires only on near-1 readings
};

const CHOICE_DATA = {
  name: "probe_choice",
  kind: "choice",
  instructions: "Grade how clearly the unit reads.",
  criteria: [
    "Clear: reads without a pause.",
    "Mixed: one pause, then recovery.",
    "Muddled: reconstruction required.",
  ],
  target: "functions",
  handle: { map: ["pass", "warn", "error"] }, // high-bad: the level index grades severity
};

/** Schema-shaped data -> compiled rule, through the same seam the CLI's baseline compiles. */
const mkRule = (kind: "noul" | "choice", over: Record<string, unknown>): Rule =>
  compileRule(
    { ...(kind === "choice" ? CHOICE_DATA : NOUL_DATA), ...over } as never,
    "lint.test.ts",
  );

/** The engine test set: every target the funnel routes, both kinds, silent at rest. */
const probeFiles = mkRule("noul", { name: "probe_files" });
const probeFunctions = mkRule("choice", { name: "probe_functions" });
const probeDefinitions = mkRule("noul", { name: "probe_definitions", target: "definitions" });
const probeComments = mkRule("noul", {
  name: "probe_comments",
  target: "comments",
  handle: { warn: { greater_than: 0.7 } },
});
const probeImports = mkRule("noul", { name: "probe_imports", target: "imports" });

const baseConfig = {
  input: "",
  include: [] as string[],
  exclude: [] as string[],
  customRules: [] as never[],
  rules: [probeFiles, probeFunctions, probeDefinitions, probeComments, probeImports],
};

describe("synthetic coverage", () => {
  test("the synthetic rule set exercises every RuleTarget and both kinds", () => {
    // The registry above is the only fixture source these engine tests have; this pin keeps its
    // minimalism honest - a target or kind added to the contract with no synthetic rule makes
    // every count below silently blind to that route. Normalize the target: the compiled JSON-tier
    // rule carries the string form; the array form is tolerated so a future multi-target rule
    // cannot skip the check.
    const targetOf = (rule: Rule): string =>
      typeof rule.target === "string" ? rule.target : (rule.target as readonly string[])[0]!;
    const targets = new Set(baseConfig.rules.map(targetOf));
    const kinds = new Set(baseConfig.rules.map((rule) => rule.kind ?? "noul"));
    const missingTargets = ruleTargets.filter((t) => !targets.has(t));
    expect(missingTargets, "a new RuleTarget/kind needs a synthetic rule exercising it").toEqual(
      [],
    );
    expect([...kinds].sort(), "a new RuleTarget/kind needs a synthetic rule exercising it").toEqual(
      ["choice", "noul"],
    );
  });
});

const FILE = "tests/fixtures/sample-file.ts"; // two definitions, no comments: d0, d1

afterAll(() => {
  rmSync("tmp/lint-walk-order-test", { recursive: true, force: true });
});

/**
 * Readings that never fire the synthetic handles (noul rules fire HIGH, the score map opens pass at
 * 0), keyed by rule name; the classifier answers these unless the test says otherwise. The 0.1
 * fallback is silent for every handle shape this file declares, so an unspecified rule never
 * produces a finding.
 */
const SILENCE: Record<string, number> = {
  probe_files: 0.1,
  probe_functions: 0,
  probe_definitions: 0.1,
  probe_comments: 0.1,
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
    const out: Record<string, ClassifiedAnswer> = {};
    for (const key of Object.keys(questions)) {
      const rule = sensorOf(key);
      const v = values[key] ?? values[rule] ?? SILENCE[rule] ?? 0.1;
      out[key] = { value: v };
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

const COMMENT_SENSOR = "probe_comments";
const DEFINITION_SENSOR = "probe_definitions";

test("classification respects custom rule targets: comment rules never judge bare definitions, definition rules never judge comment elements", async () => {
  const log: CallLog = { calls: [] };
  await drain(
    lint({
      config: { ...baseConfig, rules: [probeComments, probeDefinitions] },
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
      if (rule === COMMENT_SENSOR) {
        // comment-family rules may judge comment elements and definitions WITH attached docblocks,
        // but never a bare definition (nothing to classify)
        expect(isCommentElement || source.includes("//")).toBe(true);
      }
      if (rule === DEFINITION_SENSOR) {
        expect(isCommentElement).toBe(false);
      }
    }
  }
});

test("oversized element: skipped with one named note per skip, siblings still judged", async () => {
  // big() is ~130k chars = ~32.5k estimated tokens: over the 30k-token backstop, never judged;
  // small() proves the run is not silently clean — the skip names itself, the rest still run.
  mkdirSync("tmp", { recursive: true });
  const file = "tmp/lint-oversize-test.ts";
  await Bun.write(
    file,
    "function big() {\n  return " +
      "1".repeat(130_000) +
      ";\n}\n\nfunction small() {\n  return 1;\n}\n",
  );
  try {
    const log: CallLog = { calls: [] };
    const report = await collectReport(
      lint({ config: baseConfig, input: file, classifier: loggingClassifier({}, log) }),
    );
    // named the way every element is named (path@L<line>, the finding anchor convention), with
    // role + label + size; "skipped:" is the machine-matchable marker (notes are plain strings)
    expect(report.notes).toHaveLength(1);
    expect(report.notes[0]).toMatch(
      new RegExp(
        "^" + file + "@L1 skipped: function 'd0' — \\d+ chars \\(over the 30000-token cap\\)$",
      ),
    );
    const elementCalls = log.calls.filter((c) => isElementCall(c.state));
    expect(elementCalls).toHaveLength(1);
    expect((elementCalls[0]!.state as { source: string }).source).toContain("small");
  } finally {
    rmSync(file, { force: true });
  }
});

async function drain(events: AsyncIterable<LintEvent>): Promise<LintEvent[]> {
  const out: LintEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

test("element-scoped run: a function whose only comment is INTERNAL is measured (one classifier call)", async () => {
  mkdirSync("tmp", { recursive: true });
  const file = "tmp/lint-internal-comment.ts";
  await Bun.write(
    file,
    [
      "export function thing(x: number): number {",
      "  const y = x * 2;",
      "  // double the input",
      "  return y + 1;",
      "}",
    ].join("\n"),
  );
  const log: CallLog = { calls: [] };
  const events = await drain(
    lint({
      config: baseConfig,
      input: file,
      only: [COMMENT_SENSOR],
      element: { path: file, anchor: 1 },
      classifier: loggingClassifier({ [COMMENT_SENSOR]: 0.8 }, log),
    }),
  );
  // the internal comment makes the definition a comment unit: the rule fires on it
  const elementCalls = log.calls.filter((c) => isElementCall(c.state));
  expect(elementCalls).toHaveLength(1);
  expect(elementCalls[0]!.questions).toContain(COMMENT_SENSOR);
  const findings = events.filter(
    (e): e is Extract<LintEvent, { type: "finding" }> => e.type === "finding",
  );
  expect(findings).toHaveLength(1);
  // no skip note: the element was measured, not skipped
  expect(events.some((e) => e.type === "note")).toBe(false);
});

test("element-scoped run: a truly comment-less element explains the skip - which element, which rules, zero calls", async () => {
  mkdirSync("tmp", { recursive: true });
  const file = "tmp/lint-comment-less.ts";
  await Bun.write(file, "export function bare(x: number): number {\n  return x + 1;\n}\n");
  const log: CallLog = { calls: [] };
  const events = await drain(
    lint({
      config: baseConfig,
      input: file,
      only: [COMMENT_SENSOR],
      element: { path: file, anchor: 1 },
      classifier: loggingClassifier({}, log),
    }),
  );
  // zero classifier calls for the skipped element
  expect(log.calls.filter((c) => isElementCall(c.state))).toHaveLength(0);
  const notes = events.filter((e): e is Extract<LintEvent, { type: "note" }> => e.type === "note");
  expect(notes).toHaveLength(1);
  // the note names element + span, the requested rule + its target, the mismatch, and that
  // nothing was measured - it must never read as a generic payload-less count
  expect(notes[0]!.note).toMatch(
    new RegExp(
      `${file}: d0 \\(L1-L3\\) not measured - no requested rule applies: probe_comments measures comments \\(d0 carries none\\); zero classifier calls were made for this selection`,
    ),
  );
});

describe("lint — classification shape", () => {
  test("one element-classification call per element (bare rule-name keys); files-target call separate", async () => {
    const log: CallLog = { calls: [] };
    await drain(lint({ config: baseConfig, input: FILE, classifier: loggingClassifier({}, log) }));
    // one call per element, state = {path, source} - the array matrix state is banned (averages)
    const elementCalls = log.calls.filter((c) => isElementCall(c.state));
    // two definitions + the file's one comment, which the three-dimension comment model keeps
    // in the bucket (it is also attached to addSeconds - presence and attachment are orthogonal)
    expect(elementCalls).toHaveLength(3);
    const sources = elementCalls.map((c) => (c.state as { path: string; source: string }).source);
    expect(sources[0]).toContain("addSeconds");
    expect(sources[1]).toContain("formatDuration");
    for (const c of elementCalls) {
      expect((c.state as { path: string }).path).toBe(FILE);
    }
    // per (element, target-matched rule): the file's one comment is now its own element (the
    // three-dimension model keeps it in the bucket as well as on d0), so the comment element
    // draws 1 question while the docblock-carrying d0 draws 3 and the bare d1 draws 2; question
    // keys inside a call are bare rule names (one element per call, no ambiguity)
    const counts = elementCalls.map((c) => c.questions.length).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3]);
    const withFunctions = elementCalls.find((c) => c.questions.includes("probe_functions"));
    const withComments = elementCalls.find((c) => c.questions.includes("probe_comments"));
    expect(withFunctions).toBeDefined();
    expect(withComments).toBeDefined();
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
    // the files-target rule keeps its own whole-content call
    const whole = log.calls.filter((c) => !isElementCall(c.state));
    expect(whole.length).toBeGreaterThanOrEqual(1);
    // whole-content call questions are keyed "<rule> in <file id>" (the content hash)
    for (const key of whole[0]!.questions) {
      expect(key).toMatch(/^probe_files in L\d+(-L\d+)?$/);
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
      expect(measurements).toHaveLength(1); // whole-unit rules only: probe_files
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
    const { classifyFile } = await import("./rules/classify.ts");
    const empty = "tests/fixtures/tmp-empty-funnel.ts";
    await Bun.write(empty, String.fromCharCode(10));
    try {
      const calls: unknown[] = [];
      const result = await classifyFile(
        { kind: "file", state: { path: empty, content: "", id: "L1" } },
        baseConfig.rules,
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

// The inline callback rule used across the custom-rule tests: an elements-target rule that takes
// every element (the walk-coverage proof).
const ELEMENTS_RULE = {
  name: "custom_elements",
  target: (elements: readonly unknown[]) => elements,
  classify: (self: { source: string }) => ({
    instructions: "i",
    criteria: { true: "t", false: "f" },
    state: { source: self.source },
  }),
  handle: { warn: { greater_than: 0.1 } },
};

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
            return Object.fromEntries(Object.keys(questions).map((k) => [k, { value: 1 }]));
          },
        }),
      );
      expect(report.measurements.length).toBeGreaterThanOrEqual(8);
      // Element ids are per-run uuids (element-identity design): normalize them out, compare
      // everything else byte-for-byte — ordering included.
      return JSON.stringify(report, (key, value) =>
        key === "input" && typeof value === "string"
          ? value.replace(/#[0-9a-f-]{36}$/, "#id")
          : value,
      );
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
          return Object.fromEntries(Object.keys(questions).map((k) => [k, { value: 0.3 }]));
        },
      }),
    );
    // one hung call = one per-element error, the run continues around it
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.code).toBe("JEV_TIMEOUT");
    expect(report.errors[0]?.input).toMatch(/\/elements\.ts#[0-9a-f-]{36}$/);
    expect(report.measurements.length).toBeGreaterThanOrEqual(2);
    rmSync(dir, { recursive: true, force: true });
  });

  test("per-rule scoping (issue 008): scoped-out elements cost zero calls and are noted", async () => {
    const scopedRule: Rule = {
      name: "is_scope_probe",
      instructions: "q",
      criteria: { true: "t", false: "f" },
      target: "definitions",
      handle: () => null,
      exclude: ["tests/**"],
    };
    const calls: string[] = [];
    const classifier: Classifier = async (state, questions) => {
      calls.push(state.path);
      return Object.fromEntries(Object.keys(questions).map((k) => [k, { value: 0.5 }]));
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
      instructions: "q",
      criteria: { true: "t", false: "f" },
      target: "definitions",
      handle: () => null,
      ...scope,
    });
    const calls = async (config: Record<string, unknown>, only?: string[]): Promise<number> => {
      let n = 0;
      await collectReport(
        lint({
          config: { rules: [], include: [], exclude: [], ...(config as object) } as never,
          only,
          input: dir,
          classifier: async (state, questions) => {
            n += Object.keys(questions).length;
            return Object.fromEntries(Object.keys(questions).map((k) => [k, { value: 0.5 }]));
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
          include: [],
          exclude: [],
          rules: [mk({ include: ["**/*.ts"], exclude: ["**/*.ts"] })],
        },
        input: dir,
        classifier: async (state, questions) =>
          Object.fromEntries(Object.keys(questions).map((k) => [k, { value: 0.5 }])),
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
        classifier: classifierWith({ probe_functions: 1 }),
      }),
    );
    const measurements = events.filter((e) => e.type === "measurement");
    const findings = events.filter((e) => e.type === "finding");
    // the whole-file call (probe_files) + the docblock-carrying d0 (functions + definitions +
    // comments) + the bare d1 (functions + definitions) + the comment element (comments)
    expect(measurements).toHaveLength(7);
    // functions level 1 (warn) fires on BOTH elements - no aggregation, no candidacy
    expect(findings).toHaveLength(2);
    // element identity is a classify-time uuid, not the positional wire id
    expect(findings.map((s) => s.finding.input.replace(/#.*$/, ""))).toEqual([FILE, FILE]);
    for (const s of findings) expect(s.finding.input).toMatch(/#[0-9a-f-]{36}$/);
    for (const s of findings) {
      expect(s.finding).toEqual({
        rule: "probe_functions",
        input: s.finding.input,
        value: 1,
        severity: "warn",
        note: CHOICE_DATA.criteria[1],
        location: { input: s.finding.input, span: expect.any(Object) },
      });
    }
  });

  test("single pass: every measurement runs its handle, each finding follows its measurement", async () => {
    const events = await drain(
      lint({
        config: baseConfig,
        input: FILE,
        classifier: classifierWith({ probe_functions: 2, probe_comments: 0.95 }),
      }),
    );
    const kinds = events.map((e) => e.type);
    for (let i = 0; i < events.length; i++) {
      // no aggregation: a finding directly follows its own measurement
      if (kinds[i] === "finding") expect(kinds[i - 1]).toBe("measurement");
    }
    // functions level 2 (error) fires on both definitions; comments warn (>0.7) fires on the
    // docblock-carrying d0 and the comment element (three-dimension model): 2 + 2
    expect(events.filter((e) => e.type === "finding")).toHaveLength(4);
    // every classified unit was measured against every in-scope rule (the files rule judged the
    // whole unit once; all three elements drew their target-matched questions)
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(7);
    // findings and measurements name the same rule, adjacent in the stream
    for (let i = 0; i < events.length; i++) {
      if (events[i]!.type === "finding") {
        const measurement = events[i - 1] as Extract<LintEvent, { type: "measurement" }>;
        const finding = events[i] as Extract<LintEvent, { type: "finding" }>;
        expect(measurement.measurement.rule).toBe(finding.finding.rule);
      }
    }
  });

  test("--disable removes rules by name before classifying", async () => {
    const log: CallLog = { calls: [] };
    const events = await drain(
      lint({
        config: baseConfig,
        input: FILE,
        disable: ["probe_files", "probe_definitions", "probe_comments"],
        classifier: loggingClassifier({}, log),
      }),
    );
    // probe_functions (functions-target) survives: one classification call per element, no
    // whole-content call
    expect(log.calls).toHaveLength(2);
    for (const c of log.calls) {
      expect(c.questions).toEqual(["probe_functions"]); // bare rule-name keys, one element per call
    }
    // 2 function elements x 1 remaining rule
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(2);
  });

  test("the paths list is the input: selection + the missing-entry note (never silence)", async () => {
    const events = await drain(
      lint({
        config: { ...baseConfig, input: "" },
        // the SDK takes the already-read text (the caller did the I/O)
        paths: { content: FILE + "\nno/such/file.ts\n" + FILE + "\n" }, // duplicate dedupes; missing noted
        classifier: classifierWith({}),
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
        .map((e) => e.measurement.input.split("#")[0]!),
    );
    expect([...inputs]).toEqual([FILE]);
  });

  test("with input also given, the path list never selects: it only notes", async () => {
    const events = await drain(
      lint({
        config: baseConfig,
        input: FILE,
        paths: { content: "tests/fixtures/sample-dir/good.ts\nno/such/file.ts\n" },
        classifier: classifierWith({}),
      }),
    );
    // the subject came from input, never the list: only FILE was judged
    const inputs = new Set(
      events
        .filter((e): e is Extract<LintEvent, { type: "measurement" }> => e.type === "measurement")
        .map((e) => e.measurement.input.split("#")[0]!),
    );
    expect([...inputs]).toEqual([FILE]);
    // entries the walk never saw — a real file outside the input, and a missing one — are
    // notes, never silence, and never a selection
    const notes = events
      .filter((e): e is Extract<LintEvent, { type: "note" }> => e.type === "note")
      .map((e) => e.note);
    expect(
      notes.some(
        (n) =>
          n.includes("not found in the walk") && n.includes("tests/fixtures/sample-dir/good.ts"),
      ),
    ).toBe(true);
    expect(
      notes.some((n) => n.includes("not found in the walk") && n.includes("no/such/file.ts")),
    ).toBe(true);
  });

  test("per-unit failure becomes a streamed error; the run continues", async () => {
    const classifier: Classifier = async (state, questions) => {
      if (state.path === FILE)
        throw new ClassifyError("JEV_UNAVAILABLE", state.path, "first unit hiccup");
      return classifierWith({})(state, questions);
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
    // the failed file's calls (whole-content + one call per element: two definitions + the
    // comment element) surface an error each
    expect(errors).toHaveLength(4);
    expect(errors[0]!.error.code).toBe("JEV_UNAVAILABLE");
    // second unit: 1 whole-file + 3 element questions batches (the comment-carrying binding
    // draws definitions + comments; the bare function draws functions + definitions; the
    // comment element draws comments - the three-dimension comment model)
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(6);
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
        classifier: classifierWith({}),
      }),
    );
    const inputs = new Set(
      events.filter((e) => e.type === "measurement").map((e) => e.measurement.input),
    );
    // non-source files measure at the file tier (probe_files); their extensions are
    // sweep coverage for the element rules. Element identity is a uuid - assert shape.
    expect(inputs).toEqual(
      new Set([
        "good.ts",
        "Makefile",
        "README.md",
        "data.json",
        ...[...inputs].filter((i) => i.includes("#")),
      ]),
    );
    // good.ts contributes two element identities now: its binding/function AND the comment
    // element the three-dimension model keeps, plus README.md's section
    expect([...inputs].filter((i) => i.includes("#"))).toHaveLength(4);
    for (const i of inputs)
      if (i.includes("#")) expect(i).toMatch(/^(good\.ts|README\.md)#[0-9a-f-]{36}$/);
    // Makefile is extensionless; more.ts was excluded, so it never appears as seen
    const coverage = events.find(
      (e): e is Extract<LintEvent, { type: "note" }> =>
        e.type === "note" &&
        e.note.startsWith(
          "parsing v, sv, ts, mts, cts, tsx, py, md, php, go, cpp, cc, cxx, hpp, h, c, css",
        ),
    );
    expect(coverage?.note).toBe(
      "parsing v, sv, ts, mts, cts, tsx, py, md, php, go, cpp, cc, cxx, hpp, h, c, css · not parsed (no grammar): (extensionless), .json",
    );
  });

  test("explicit file + files-target rules only: measured raw, no MISSING_GRAMMAR", async () => {
    const events = await drain(
      lint({
        config: {
          ...baseConfig,
          input: "tests/fixtures/sample-dir/data.json",
          inputType: "file",
          rules: [probeFiles],
        },
        classifier: classifierWith({ probe_files: 0.9 }),
      }),
    );
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(1);
  });

  test("an inline callback element rule forces the walk: non-source files become sweep coverage", async () => {
    const events = await drain(
      lint({
        config: {
          ...baseConfig,
          input: "tests/fixtures/sample-dir",
          inputType: "dir",
          rules: [],
          customRules: [ELEMENTS_RULE as never],
        },
        classifier: classifierWith({}),
      }),
    );
    const coverage = events.find(
      (e): e is Extract<LintEvent, { type: "note" }> =>
        e.type === "note" &&
        e.note.startsWith(
          "parsing v, sv, ts, mts, cts, tsx, py, md, php, go, cpp, cc, cxx, hpp, h, c, css",
        ),
    );
    expect(coverage?.note).toBe(
      "parsing v, sv, ts, mts, cts, tsx, py, md, php, go, cpp, cc, cxx, hpp, h, c, css · not parsed (no grammar): (extensionless), .json",
    );
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
  });

  test("custom rule set (selection = the rule list itself)", async () => {
    const only: Rule[] = [probeDefinitions];
    const config = { ...baseConfig, input: "", rules: only };
    const events = await drain(
      lint({
        config,
        input: FILE,
        classifier: classifierWith({ probe_definitions: 0 }),
      }),
    );
    // definitions target: 2 sweep questions, no candidates at 0
    expect(events.filter((e) => e.type === "measurement")).toHaveLength(2);
  });
});

describe("collectReport", () => {
  test("drains the stream into measurements/findings/errors", async () => {
    const report = await collectReport(
      lint({
        config: baseConfig,
        input: FILE,
        classifier: classifierWith({ probe_functions: 1 }),
      }),
    );
    expect(report.measurements).toHaveLength(7);
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
        only: ["probe_files"],
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

  test("a close miss carries the nearest known rule name in the detail (data, not prose)", async () => {
    await expect(
      drain(
        lint({
          config: baseConfig,
          input: "tests/fixtures/sample-file.ts",
          only: ["probe_files_x"],
          classifier: classifierWith({}),
        }),
      ),
    ).rejects.toMatchObject({
      name: "SetupError",
      code: "CONFIG_INVALID",
      message: 'unknown rule "probe_files_x"',
      detail: { kind: "unknown-rule", suggest: "probe_files" },
    });
  });
});

describe("lint — inline callback rules (content retention, the logical content-drop)", () => {
  // Targets ONLY good.ts's elements: sample-file.ts has zero selected targets.
  const GOOD_TS_PROBE = {
    name: "ts_retention_probe",
    target: (elements: readonly { path: string }[]) =>
      elements.filter((e) => e.path.endsWith("good.ts")),
    classify: (self: { source: string }) => ({
      instructions: "i",
      criteria: { true: "t", false: "f" },
      state: { source: self.source },
    }),
    handle: { warn: { greater_than: 0.1 }, error: { greater_than: 0.2 } },
  };
  const FILES_RULE = {
    name: "is_files_retention_probe",
    kind: "noul" as const,
    criteria: { true: "t", false: "f" },
    target: "files" as const,
    handle: () => null, // never fires: the rule classifies, nothing is actionable
  };
  const GOOD = "tests/fixtures/sample-dir/good.ts";
  const isWholeFileCall = (state: AnyState): boolean =>
    "content" in state && typeof state.content === "string";

  test("a files-target JSON rule retains EVERY file's content even when callback rules target only one file", async () => {
    const log: CallLog = { calls: [] };
    await drain(
      lint({
        config: {
          ...baseConfig,
          rules: [FILES_RULE as never],
          customRules: [GOOD_TS_PROBE as never],
        },
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

  test("an inline callback rule's own scope filters at run time", async () => {
    // rule_a includes good.ts only; rule_b includes sample-file.ts only. Each rule's scope is
    // its own - no fragment defaults exist anymore, so each measures exactly its include.
    const scoped = (name: string, include: string[]): unknown => ({
      name,
      include,
      target: (elements: readonly unknown[]) => elements,
      classify: (self: { source: string }) => ({
        instructions: "i",
        criteria: { true: "t", false: "f" },
        state: { source: self.source },
      }),
      handle: { warn: { greater_than: 0.9 } },
    });
    const events = await drain(
      lint({
        config: {
          ...baseConfig,
          customRules: [
            scoped("rule_scope_good", ["**/good.ts"]),
            scoped("rule_scope_sample", ["**/sample-file.ts"]),
          ] as never,
        },
        input: [FILE, GOOD],
        classifier: loggingClassifier(
          { rule_scope_good: 0.5, rule_scope_sample: 0.5 },
          { calls: [] },
        ),
      }),
    );
    const byRule = new Map<string, string[]>();
    for (const e of events.filter((e) => e.type === "measurement")) {
      const m = (e as { measurement: { rule: string; input: string } }).measurement;
      byRule.set(m.rule, [...(byRule.get(m.rule) ?? []), m.input.split("#")[0]!]);
    }
    expect(byRule.get("rule_scope_good")!.every((p) => p === GOOD)).toBe(true);
    expect(byRule.get("rule_scope_good")!.length).toBeGreaterThan(0);
    expect(byRule.get("rule_scope_sample")!.every((p) => p === FILE)).toBe(true);
    expect(byRule.get("rule_scope_sample")!.length).toBeGreaterThan(0);
  });

  test("zero-target files are logically dropped: no whole-file call, but element classification still runs", async () => {
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
              handle: () => null, // never fires: the rule classifies, nothing is actionable
            } as never,
          ],
          customRules: [GOOD_TS_PROBE as never],
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
    // The custom rule measured ONLY on its targets (both in good.ts; nothing from sample-file.ts).
    const tsMeasurements = events.filter(
      (e) => e.type === "measurement" && e.measurement.rule === "ts_retention_probe",
    );
    // the custom rule's targets in good.ts: the binding-carrying element, the function, and the
    // comment element (three-dimension model)
    expect(tsMeasurements).toHaveLength(3);
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
    handle: () => null, // never fires: the rule classifies, nothing is actionable
  };

  test("an element-free file under files-target rules is healthy: measured in order, no WALK_FAILED", async () => {
    // the walk is a dependency of inventory-scoped rules only; a files-target unit measures from
    // raw source, so zero elements is its healthy state (the walk is never even taken)
    mkdirSync(ORDER_DIR, { recursive: true });
    writeFileSync(BROKEN, ";");
    const events = await drain(
      lint({
        config: { ...baseConfig, rules: [FILES_RULE as never] },
        // The element-free unit is FIRST: its whole-file measurement still yields before the
        // next unit's classification events (per-wave, per-unit order).
        input: [BROKEN, FILE],
        classifier: classifierWith({ is_files_order_probe: 0.9 }),
      }),
    );
    expect(events.findIndex((e) => e.type === "error" && e.error.code === "WALK_FAILED")).toBe(-1);
    const measurements = events.filter((e) => e.type === "measurement");
    expect(measurements.length).toBeGreaterThan(1);
    expect(
      events.findIndex(
        (e) => e.type === "measurement" && e.measurement.input.includes("sample-file"),
      ),
    ).toBeGreaterThan(
      events.findIndex((e) => e.type === "measurement" && e.measurement.input.includes("empty.ts")),
    );
  });
});

describe("lint — str unit is its own inventory", () => {
  const classifier: Classifier = async (_state, questions) =>
    Object.fromEntries(Object.keys(questions).map((k) => [k, { value: 0.5 }]));

  test("any rule judges the str unit whole, no grammar, no WALK_FAILED", async () => {
    // an element-target rule over a str unit: the whole input is the element, no mapping
    const events = await drain(
      lint({
        config: baseConfig,
        str: { content: "const x = 1;\n" },
        only: ["probe_functions"],
        classifier,
      }),
    );
    const errors = events.filter(
      (e): e is Extract<LintEvent, { type: "error" }> => e.type === "error",
    );
    expect(errors).toHaveLength(0);
    const measurements = events.filter((e) => e.type === "measurement");
    expect(measurements).toHaveLength(1);
    expect(measurements[0]!.measurement.element?.kind).toBe("file");
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
    ).rejects.toMatchObject({ name: "SetupError", code: "MISSING_GRAMMAR" });
  });
});
