import { describe, test, expect } from "bun:test";
import { ruleTargets, type RuleTarget } from "@jint/contract";
import { validateConfig } from "../../config/load.ts";
import {
  ClassifyError,
  type ClassifiedAnswer,
  type Classifier,
  type Measurement,
  type Refusal,
  type Rule,
  type Unit,
  type UnitState,
} from "../types.ts";
import { matchesTarget, selectElement, selectElements } from "./classify.ts";
import {
  elementWireId,
  compileRuleQuestions,
  compileElementQuestions,
  classifyUnit,
  toClassifyError,
} from "./classify.ts";

/**
 * Schema-shaped rule data, one per kind - exactly the fields a config entry carries. Written inline
 * so these tests pin the compile SEAM, never the default set: a defaults edit cannot move them, and
 * a seam change must fail here against data this file owns.
 */
const NOUL_DATA = {
  name: "probe_noul",
  instructions: "Is this unit what its name promises?",
  criteria: { true: "It is what the name promises.", false: "It is something else." },
  target: "files",
} as const;

const SCORE_DATA = {
  name: "probe_score",
  kind: "score",
  instructions: "Grade how clearly the unit reads.",
  criteria: [
    "Clear: reads without a pause.",
    "Mixed: one pause, then recovery.",
    "Muddled: reconstruction required.",
  ],
  target: "functions",
} as const;

/** The classify seam never applies handles (severity is downstream) - one inert handle serves. */
const noop = (): null => null;

/** Compiled views of the schema data: the shape the seam consumes. */
const noulFile: Rule = { ...NOUL_DATA, handle: noop };
const scoreFn: Rule = { ...SCORE_DATA, handle: noop };
/** Target variants restate only the differing field; routing tests swap these in. */
const noulDefs: Rule = { ...NOUL_DATA, name: "probe_defs", target: "definitions", handle: noop };
const scoreDefs: Rule = {
  ...SCORE_DATA,
  name: "probe_defs",
  target: "definitions",
  handle: noop,
};

const fileUnit: Unit = {
  kind: "file",
  state: {
    path: "src/a.ts",
    content: "export const x = 1;\n",
    id: elementWireId({ start: { line: 1 }, end: { line: 2 } }),
  },
};
const sensors: readonly Rule[] = [noulFile, scoreFn];

const FILE_ID = elementWireId({ start: { line: 1 }, end: { line: 2 } });

function classifierWith(values: Record<string, number>, calls: Unit[] = []): Classifier {
  return async (state, questions) => {
    calls.push({ kind: "file", state: state as UnitState });
    const out: Record<string, ClassifiedAnswer> = {};
    for (const key of Object.keys(questions)) {
      // keys are "<rule> in <unitId>" (multi-rule) or the bare unitId (single rule)
      const rule = key.includes(" in ")
        ? key.slice(0, key.indexOf(" in "))
        : Object.keys(values)[0]!;
      if (rule in values) out[key] = { value: values[rule]! };
    }
    return out;
  };
}

function isMeasurement(event: Measurement | ClassifyError): event is Measurement {
  return !(event instanceof ClassifyError);
}

describe("compileRuleQuestions", () => {
  test("whole-file unit: criteria passthrough verbatim, question type follows kind", () => {
    const { questions, attribution } = compileRuleQuestions(sensors, FILE_ID);
    const noulQ = questions[`probe_noul in ${FILE_ID}`]!;
    expect(noulQ.type).toBe("noul");
    expect(noulQ.instructions).toBe(NOUL_DATA.instructions);
    expect(noulQ.criteria).toBe(NOUL_DATA.criteria); // the rule's own criteria object, untouched
    const scoreQ = questions[`probe_score in ${FILE_ID}`]!;
    expect(scoreQ.type).toBe("score");
    expect(scoreQ.instructions).toBe(SCORE_DATA.instructions);
    expect(scoreQ.criteria).toBe(SCORE_DATA.criteria);
    expect(attribution.get(`probe_noul in ${FILE_ID}`)).toEqual({
      rule: "probe_noul",
      blockId: FILE_ID,
    });
  });

  test("block-scoped: '<rule> in <unitId>' ids, same kind mapping", () => {
    const { questions, attribution } = compileRuleQuestions([noulFile, scoreFn], "block-3");
    expect(questions["probe_noul in block-3"]!.type).toBe("noul");
    expect(questions["probe_score in block-3"]!.type).toBe("score");
    expect(questions["probe_noul in block-3"]!.criteria).toBe(NOUL_DATA.criteria);
    expect(attribution.get("probe_score in block-3")).toEqual({
      rule: "probe_score",
      blockId: "block-3",
    });
  });

  test("elementWireId: LOC interval from the span", () => {
    expect(elementWireId({ start: { line: 1 }, end: { line: 2 } })).toBe("L1-L2");
    expect(elementWireId({ start: { line: 1 }, end: { line: 3 } })).toBe("L1-L3");
    expect(elementWireId({ start: { line: 7 }, end: { line: 7 } })).toBe("L7");
  });
});

describe("classifyUnit", () => {
  test("ONE batched classifier call per unit; one measurement per rule", async () => {
    const calls: Unit[] = [];
    const classifier = classifierWith({ probe_noul: 0.7, probe_score: 2 }, calls);
    const events: (Measurement | ClassifyError)[] = [];
    for await (const event of classifyUnit(fileUnit, sensors, classifier)) events.push(event);
    expect(events).toHaveLength(2);
    expect(events.every(isMeasurement)).toBe(true);
    expect((events as Measurement[]).map((m) => m.rule)).toEqual(["probe_noul", "probe_score"]);
    expect(calls).toHaveLength(1); // one batched call, not one per rule
  });

  test("values pass through untouched", async () => {
    const classifier = classifierWith({ probe_noul: 0.5347219 });
    for await (const event of classifyUnit(fileUnit, [noulFile], classifier)) {
      expect(isMeasurement(event) && !event.refused && event.value).toBe(0.5347219);
    }
  });

  test("missing or non-finite answer -> PROVIDER_RESPONSE_INVALID error, siblings continue", async () => {
    const classifier = classifierWith({ probe_noul: 0.7, probe_score: Number.NaN });
    const events: (Measurement | ClassifyError)[] = [];
    for await (const event of classifyUnit(fileUnit, [noulFile, scoreFn, noulDefs], classifier)) {
      events.push(event);
    }
    const errors = events.filter((e): e is ClassifyError => !isMeasurement(e));
    const measurements = events.filter(isMeasurement);
    expect(measurements.map((m) => m.rule)).toEqual(["probe_noul"]);
    expect(errors).toHaveLength(2); // NaN for probe_score, missing probe_defs
    expect(errors[0]!.code).toBe("PROVIDER_RESPONSE_INVALID");
    expect(errors[0]!.message).toContain("probe_score");
    expect(errors[1]!.message).toContain("probe_defs");
  });

  test("classifier throwing ClassifyError -> streamed error with the same code", async () => {
    const classifier: Classifier = async () => {
      throw new ClassifyError("PROVIDER_UNAVAILABLE", "src/a.ts", "provider unreachable: boom");
    };
    const events: (Measurement | ClassifyError)[] = [];
    for await (const event of classifyUnit(fileUnit, sensors, classifier)) events.push(event);
    expect(events).toHaveLength(1);
    expect((events[0] as ClassifyError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((events[0] as ClassifyError).message).toContain("boom");
    expect((events[0] as ClassifyError).input).toBe("src/a.ts");
  });

  test("classifier throwing a plain Error -> INTERNAL error, never thrown past the pipeline", async () => {
    const classifier: Classifier = async () => {
      throw new Error("surprise");
    };
    const events: (Measurement | ClassifyError)[] = [];
    for await (const event of classifyUnit(fileUnit, sensors, classifier)) events.push(event);
    expect((events[0] as ClassifyError).code).toBe("INTERNAL");
  });

  test("no rules -> classifier never called", async () => {
    let called = false;
    const classifier: Classifier = async () => {
      called = true;
      return {};
    };
    const events: (Measurement | ClassifyError)[] = [];
    for await (const event of classifyUnit(fileUnit, [], classifier)) {
      events.push(event);
    }
    expect(called).toBe(false);
    expect(events).toHaveLength(0);
  });
});

describe("toClassifyError", () => {
  test("non-Error throwables become INTERNAL errors", () => {
    const error = toClassifyError(fileUnit.state.path, "a string was thrown");
    expect(error.code).toBe("INTERNAL");
    expect(error.message).toBe("a string was thrown");
    expect(error.input).toBe("src/a.ts");
  });

  test("a plain Error chains the original as cause", () => {
    const thrown = new Error("socket hang up");
    const error = toClassifyError("src/a.ts", thrown);
    expect(error.code).toBe("INTERNAL");
    expect(error.message).toBe("socket hang up");
    expect(error.cause).toBe(thrown);
  });

  test("a thrown ClassifyError keeps its code; input is refined", () => {
    const thrown = new ClassifyError("PROVIDER_AUTH", "other.ts", "rejected");
    const error = toClassifyError("src/a.ts", thrown);
    expect(error.code).toBe("PROVIDER_AUTH");
    expect(error.input).toBe("src/a.ts");
  });
});

describe("compileRuleQuestions — composite keys", () => {
  test("one state x many questions: keys stay '<rule> in <unitId>'", () => {
    const { questions } = compileRuleQuestions([noulFile, scoreFn], "a1b2c3d4");
    expect(Object.keys(questions).sort()).toEqual([
      "probe_noul in a1b2c3d4",
      "probe_score in a1b2c3d4",
    ]);
  });
});

describe("compileElementQuestions", () => {
  test("one element per call: question keys are bare rule names, type follows kind, instructions pass through unprefixed", () => {
    const questions = compileElementQuestions([noulFile, scoreFn], "comment");
    expect(Object.keys(questions).sort()).toEqual(["probe_noul", "probe_score"]);
    expect(questions.probe_noul!.type).toBe("noul");
    expect(questions.probe_noul!.instructions).toBe(
      (noulFile as { instructions: string }).instructions,
    );
    expect(questions.probe_score!.type).toBe("score");
    expect(questions.probe_score!.instructions).toBe(
      (scoreFn as { instructions: string }).instructions,
    );
  });

  test("a noul rule without instructions fails config schema validation (strict, no fallback)", () => {
    // The fallback is cut: a rule without its question would classify under an invented prompt
    // and silently recalibrate every reading. The config boundary rejects it, naming the field.
    expect(() =>
      validateConfig(
        {
          input: "x",
          rules: [
            {
              name: "bare_rule",
              criteria: { true: "yes", false: "no" },
              target: "files",
              handle: { warn: { less_than: 0.4 } },
            },
          ],
        },
        "inline",
      ),
    ).toThrow(/\/rules\/0\/instructions/);
  });
});

describe("classifyFile — element fan-out", () => {
  test("one element per call; the run-wide concurrency knob binds (matrix state banned)", async () => {
    // classify() carries the run knobs at the classifier seam: the ceiling must actually bind
    // when lowered (one knob, one behavior - the old per-file pool is gone).
    const { classify } = await import("../classify.ts");
    const lines = Array.from(
      { length: 12 },
      (_, i) => `export function f${i}(): number { return ${i}; }`,
    );
    const content = lines.join("\n") + "\n";
    let inFlight = 0;
    let maxInFlight = 0;
    const classifier: Classifier = async (state, questions) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      // state is the single element's source, not an elements array
      expect("source" in state).toBe(true);
      expect("elements" in state).toBe(false);
      return Object.fromEntries(Object.keys(questions).map((k) => [k, { value: 0.5 }]));
    };
    const { measurements, errors } = await classify(content, [scoreDefs], {
      path: "src/gen.ts", // extension names the grammar; "input" (default) would WALK_FAILED
      classifier,
      concurrency: 4,
    });
    expect(measurements).toHaveLength(12);
    expect(errors).toHaveLength(0);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1); // concurrent, not sequential
  });
});

describe("classifyFile — role routing", () => {
  const fnRule = scoreFn; // functions-target: judges callables only

  test("a binding const gets a definitions-target measurement and zero functions-target ones", async () => {
    const { classifyFile } = await import("./classify.ts");
    const defRule = noulDefs; // definitions-target: judges const names too
    const classifier: Classifier = async (_state, questions) =>
      Object.fromEntries(Object.keys(questions).map((k) => [k, { value: 0.5 }]));
    const { events } = await classifyFile(
      {
        kind: "file",
        state: { path: "src/data.ts", content: "const report = buildReport();\n", id: "L1" },
      },
      [fnRule, defRule],
      classifier,
    );
    const classified = events.filter((e) => !(e.event instanceof ClassifyError));
    expect(classified).toHaveLength(1); // definitions-target only
    expect((classified[0]!.event as Measurement).rule).toBe("probe_defs");
  });

  test("an element question the model never answered is an error, not a dropped reading", async () => {
    const { classifyFile } = await import("./classify.ts");
    const answered: Rule = { ...scoreFn, name: "probe_answered" };
    // the model answers one of the element's two questions and declines the other
    const classifier: Classifier = async () => ({ probe_answered: { value: 1 } });
    const { events } = await classifyFile(
      {
        kind: "file",
        state: { path: "src/sum.ts", content: "function sum(a, b) { return a + b; }\n", id: "L1" },
      },
      [fnRule, answered],
      classifier,
    );
    const errors = events.filter((e) => e.event instanceof ClassifyError);
    expect(events.filter((e) => !(e.event instanceof ClassifyError))).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect((errors[0]!.event as ClassifyError).message).toContain("probe_score");
    // the error names its rule, so the run view can open that question at that element
    expect((errors[0]!.event as ClassifyError).rule).toBe("probe_score");
  });

  test("a refusal is a refused measurement: no error, siblings kept, malformed still errors", async () => {
    const { classifyFile } = await import("./classify.ts");
    const kept: Rule = { ...scoreFn, name: "probe_kept" };
    const broken: Rule = { ...scoreFn, name: "probe_broken" };
    const classifier: Classifier = async () =>
      ({
        probe_score: { refused: true },
        probe_kept: { value: 1 },
        probe_broken: { value: Number.NaN },
      }) as Record<string, ClassifiedAnswer | Refusal>;
    const { events } = await classifyFile(
      {
        kind: "file",
        state: { path: "src/sum.ts", content: "function sum(a, b) { return a + b; }\n", id: "L1" },
      },
      [fnRule, kept, broken],
      classifier,
    );
    const measurements = events.map((e) => e.event).filter(isMeasurement);
    const refused = measurements.find((m) => m.rule === "probe_score")!;
    expect(refused.refused).toBe(true);
    expect("value" in refused).toBe(false);
    expect(refused.input).toMatch(/^src\/sum\.ts#/);
    expect(refused.rule).toBe("probe_score");
    expect(measurements.find((m) => m.rule === "probe_kept")?.refused).toBeUndefined();
    const errors = events.map((e) => e.event).filter((e) => e instanceof ClassifyError);
    expect(errors.map((e) => e.rule)).toEqual(["probe_broken"]);
  });

  test("an arrow-function const still gets the functions-target measurement", async () => {
    const { classifyFile } = await import("./classify.ts");
    const classifier: Classifier = async (_state, questions) =>
      Object.fromEntries(Object.keys(questions).map((k) => [k, { value: 0.5 }]));
    const { events } = await classifyFile(
      {
        kind: "file",
        state: {
          path: "src/arrow.ts",
          content: "const add = (a: number, b: number): number => a + b;\n",
          id: "L1",
        },
      },
      [fnRule],
      classifier,
    );
    const classified = events.filter((e) => !(e.event instanceof ClassifyError));
    expect(classified).toHaveLength(1);
    expect((classified[0]!.event as Measurement).rule).toBe("probe_score");
  });
});

describe("classifyFile — imports routing", () => {
  const importRule: Rule = {
    name: "is_import_pinned",
    instructions: "Is this an import?",
    target: "imports",
    criteria: { true: "pinned", false: "not pinned" },
    handle: () => null,
  };
  const fnRule = scoreFn;
  const withImports = [
    'import { configPlugin } from "./plugin.js";',
    'import type { Rule } from "../types.js";',
    "export function main(): number { return configPlugin(1); }",
    "",
  ].join("\n");
  const noImports = "export function main(): number { return 1; }\n";
  const classifier: Classifier = async (_state, questions) =>
    Object.fromEntries(Object.keys(questions).map((k) => [k, { value: 0.5 }]));

  test("an imports-target rule classifies the import element when imports exist", async () => {
    const { classifyFile } = await import("./classify.ts");
    const { events } = await classifyFile(
      { kind: "file", state: { path: "src/app.ts", content: withImports, id: "L1-L4" } },
      [importRule],
      classifier,
    );
    const errors = events.filter((e) => e.event instanceof ClassifyError);
    expect(errors).toHaveLength(0);
    const classified = events.filter((e) => !(e.event instanceof ClassifyError));
    expect(classified.length).toBeGreaterThanOrEqual(1);
  });

  test("the import measurement's input and span identify the import", async () => {
    const { classifyFile } = await import("./classify.ts");
    const { events } = await classifyFile(
      { kind: "file", state: { path: "src/app.ts", content: withImports, id: "L1-L4" } },
      [importRule],
      classifier,
    );
    const classified = events.filter((e) => !(e.event instanceof ClassifyError));
    expect(classified.length).toBeGreaterThanOrEqual(1);
    const first = classified[0]!;
    // the element's identity is a classify-time uuid, not the positional wire id
    expect((first.event as Measurement).input).toMatch(/^src\/app\.ts#[0-9a-f-]{36}$/);
    expect(first.element?.span.start.line).toBe(1);
    expect(first.element?.span.end.line).toBe(2);
  });

  test("a functions-target rule's count is unchanged over the same fixture", async () => {
    const { classifyFile } = await import("./classify.ts");
    const { events } = await classifyFile(
      { kind: "file", state: { path: "src/app.ts", content: withImports, id: "L1-L4" } },
      [fnRule],
      classifier,
    );
    const classified = events.filter((e) => !(e.event instanceof ClassifyError));
    expect(classified).toHaveLength(1);
    expect((classified[0]!.event as Measurement).rule).toBe("probe_score");
  });

  test("an imports-target rule over code with no imports classifies nothing, no error", async () => {
    const { classifyFile } = await import("./classify.ts");
    const { events } = await classifyFile(
      { kind: "file", state: { path: "src/app.ts", content: noImports, id: "L1" } },
      [importRule],
      classifier,
    );
    expect(events.filter((e) => e.event instanceof ClassifyError)).toHaveLength(0);
    expect(events.filter((e) => !(e.event instanceof ClassifyError))).toHaveLength(0);
  });
});

describe("selectElement - LOC resolution for element-scoped runs", () => {
  const inventory = [
    {
      label: "d0",
      span: {
        start: { line: 1, column: 0 },
        end: { line: 3, column: 1 },
        startByte: 0,
        endByte: 82,
      },
      content: "fn0",
      nodeType: "function_declaration",
      role: "function",
      internalCommentCount: 0,
    },
    {
      label: "d1",
      span: {
        start: { line: 5, column: 0 },
        end: { line: 7, column: 1 },
        startByte: 84,
        endByte: 160,
      },
      content: "fn1",
      nodeType: "function_declaration",
      role: "function",
      internalCommentCount: 0,
    },
  ] as any[];

  test("containment: first line, last line, gap, inside, miss", () => {
    expect(selectElement(inventory, { line: 1 })?.label).toBe("d0");
    expect(selectElement(inventory, { line: 3 })?.label).toBe("d0");
    expect(selectElement(inventory, { line: 4 })).toBeUndefined();
    expect(selectElement(inventory, { line: 5 })?.label).toBe("d1");
    expect(selectElement(inventory, { line: 7 })?.label).toBe("d1");
    expect(selectElement(inventory, { line: 8 })).toBeUndefined();
  });
});

describe("selectElements - RANGE resolution: fully-enclosed only", () => {
  const inventory = [
    {
      label: "d0",
      span: {
        start: { line: 1, column: 0 },
        end: { line: 3, column: 1 },
        startByte: 0,
        endByte: 82,
      },
      content: "fn0",
      nodeType: "function_declaration",
      role: "function",
      internalCommentCount: 0,
    },

    {
      label: "d1",
      span: {
        start: { line: 5, column: 0 },
        end: { line: 7, column: 1 },
        startByte: 84,
        endByte: 160,
      },
      content: "fn1",
      nodeType: "function_declaration",
      role: "function",
      internalCommentCount: 0,
    },
  ] as any[];

  test("a range fully inside one unit selects exactly it", () => {
    expect(selectElements(inventory, { start: 1, end: 3 }).map((e) => e.label)).toEqual(["d0"]);

    expect(selectElements(inventory, { start: 2, end: 2 })).toEqual([]); // [2,2] does not enclose L1-L3
  });

  test("THE PIN: a range straddling a boundary selects ONLY the fully-enclosed", () => {
    // [4,4] touches both d0 (ends L3... no) - use [3,5]: d0 ends L3 (enclosed? start>=3 no), d1 starts L5 (end<=5 no)

    expect(selectElements(inventory, { start: 3, end: 5 })).toEqual([]);

    // [1,7] encloses both exactly:

    expect(selectElements(inventory, { start: 1, end: 7 }).map((e) => e.label)).toEqual([
      "d0",
      "d1",
    ]);

    // [2,7]: d0 starts L1 < 2 - excluded even though the range covers most of it:

    expect(selectElements(inventory, { start: 2, end: 7 }).map((e) => e.label)).toEqual(["d1"]);
  });

  test("a range enclosing nothing selects nothing (caller reports the miss)", () => {
    expect(selectElements(inventory, { start: 8, end: 90 })).toEqual([]);
  });
});

describe("classifyFile — the file-unit token backstop", () => {
  test("a file over the cap skips its file-scope calls with a note; element rules still measure", async () => {
    const { classifyFile } = await import("./classify.ts");
    // a line of padding that stays over the 120k-char (30k estimated tokens) backstop
    const filler = "const pad = [" + "0,".repeat(60_000) + "];\n";
    const elementRule = noulDefs; // definitions-target: still measures the file's elements
    const calls: Unit[] = [];
    const classifier = classifierWith({ probe_noul: 0.5 }, calls);
    const { events, notes } = await classifyFile(
      {
        kind: "file",
        state: {
          path: "src/huge.ts",
          content: filler + "export const tiny = 1;\n",
          id: FILE_ID,
        },
      },
      [noulFile, elementRule],
      classifier,
    );
    // no request ever carried the file unit (file state = {content}); the one call out is the
    // ELEMENT call - the file-scope call is skipped, not 400'd
    expect(calls.filter((c) => "content" in c.state)).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(notes).toContain(
      `file too large for file-scope rules - ${filler.length + 23} chars over the 30000-token backstop`,
    );
    const classified = events.filter((e) => !(e.event instanceof ClassifyError));
    expect(classified.length).toBeGreaterThan(0); // element rules still measured
    expect((classified[0]!.event as Measurement).rule).toBe("probe_defs");
  });

  test("a file over the cap with NO file-scope rules measures normally, no note", async () => {
    const { classifyFile } = await import("./classify.ts");
    const filler = "const pad = [" + "0,".repeat(60_000) + "];\n";
    const calls: Unit[] = [];
    const classifier = classifierWith({ probe_defs: 0.5 }, calls);
    const { notes } = await classifyFile(
      {
        kind: "file",
        state: { path: "src/huge2.ts", content: filler + "export const tiny = 1;\n", id: FILE_ID },
      },
      [noulDefs],
      classifier,
    );
    expect(notes).not.toContain(expect.stringContaining("file too large for file-scope rules"));
    expect(calls.length).toBeGreaterThan(0); // element calls went out
  });
});

describe("THE TARGET CHAIN (single source, exhaustively pinned)", () => {
  // every shared target resolves to a NON-DEGENERATE predicate: given an element of the right
  // shape, matchesTarget answers true. A target that can never fire (always-false) is drift.
  const singular: Partial<Record<RuleTarget, string>> = {
    functions: "function",
    classes: "class",
    methods: "method",
    types: "type",
    bindings: "binding",
    imports: "import",
  };
  test("every ruleTarget resolves true on its element shape (files is whole-unit, skipped)", () => {
    for (const target of ruleTargets) {
      if (target === "files") continue; // whole-unit: never element-addressable, by design
      if (target in singular) {
        expect(matchesTarget(target, { capture: singular[target]!, grammar: "typescript" })).toBe(
          true,
        );
      }
    }
    // the umbrella catches each definition capture; the comment pair covers both buckets
    expect(matchesTarget("definitions", { capture: "function", grammar: "typescript" })).toBe(true);
    expect(
      matchesTarget("comments", {
        capture: "comment",
        grammar: "typescript",
        attachedComment: ["docs"],
      }),
    ).toBe(true);
    expect(matchesTarget("loose-comments", { capture: "comment", grammar: "typescript" })).toBe(
      true,
    );
  });

  test("an unknown bare target cannot reach the evaluator silently (invariant, not behavior)", () => {
    expect(() => matchesTarget("funtions", { capture: "function", grammar: "typescript" })).toThrow(
      /unvalidated rule target/,
    );
  });
});
