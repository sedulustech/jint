import { describe, test, expect } from "bun:test";
import { validateConfig } from "../../config/load.ts";
import { defaultRules } from "../../test-baseline.ts";
import {
  ClassifyError,
  type ClassifiedAnswer,
  type Classifier,
  type Measurement,
  type Rule,
  type Unit,
  type UnitState,
} from "../types.ts";
import { selectElement, selectElements } from "./classify.ts";
import {
  elementWireId,
  compileRuleQuestions,
  compileElementQuestions,
  classifyUnit,
  toClassifyError,
} from "./classify.ts";

const fileUnit: Unit = {
  kind: "file",
  state: {
    path: "src/a.ts",
    content: "export const x = 1;\n",
    id: elementWireId({ start: { line: 1 }, end: { line: 2 } }),
  },
};
const allSensors: readonly Rule[] = Object.values(defaultRules);

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
  return "rule" in event;
}

describe("compileRuleQuestions", () => {
  test("whole-file unit: criteria passthrough, instructions is the rule's question", () => {
    const rule = defaultRules.is_name_purposeful!;
    const { questions, attribution } = compileRuleQuestions([rule], FILE_ID);
    const spec = questions[`is_name_purposeful in ${FILE_ID}`]!;
    expect(spec.type).toBe("noul");
    expect(spec.instructions).toBe("This unit is a source file. " + rule.instructions!);
    expect(spec.criteria).toBe(rule.criteria);
    expect(attribution.get(`is_name_purposeful in ${FILE_ID}`)).toEqual({
      rule: "is_name_purposeful",
      blockId: FILE_ID,
    });
  });

  test("block-scoped: '<rule> in <unitId>' ids", () => {
    const rule = defaultRules.is_name_purposeful!;
    const { questions, attribution } = compileRuleQuestions([rule], "block-3");
    const spec = questions["is_name_purposeful in block-3"]!;
    expect(spec.instructions).toBe("This unit is a source file. " + rule.instructions!);
    expect(spec.criteria).toBe(rule.criteria);
    expect(attribution.get("is_name_purposeful in block-3")).toEqual({
      rule: "is_name_purposeful",
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
    const classifier = classifierWith(
      {
        is_name_purposeful: 0.7,
        is_vocabulary_consistent: 0.8,
        is_naming_convention_consistent: 0.9,
        is_greppable: 0.6,
        is_comment_narration: 0.2,
        is_comment_patching_readability: 0.1,
        will_comment_drift: 0.1,
        is_cognitively_complex: 0.3,
        is_function_srp: 0.8,
        will_error_lose_cause: 0.2,
        is_filename_fitting: 0.1,
      },
      calls,
    );
    const events: (Measurement | ClassifyError)[] = [];
    for await (const event of classifyUnit(fileUnit, allSensors, classifier)) events.push(event);
    expect(events).toHaveLength(11);
    expect(events.every(isMeasurement)).toBe(true);
    expect((events as Measurement[]).map((m) => m.rule)).toContain("is_name_purposeful");
    expect(calls).toHaveLength(1); // one batched call, not one per rule
  });

  test("values pass through untouched", async () => {
    const classifier = classifierWith({ is_name_purposeful: 0.5347219 });
    for await (const event of classifyUnit(
      fileUnit,
      [defaultRules.is_name_purposeful!],
      classifier,
    )) {
      expect(isMeasurement(event) && event.value).toBe(0.5347219);
    }
  });

  test("missing or non-finite answer -> JEV_RESPONSE_INVALID error, siblings continue", async () => {
    const classifier = classifierWith({
      is_name_purposeful: 0.7,
      is_vocabulary_consistent: Number.NaN,
    });
    const events: (Measurement | ClassifyError)[] = [];
    for await (const event of classifyUnit(
      fileUnit,
      [
        defaultRules.is_name_purposeful!,
        defaultRules.is_vocabulary_consistent!,
        defaultRules.is_greppable!,
      ],
      classifier,
    )) {
      events.push(event);
    }
    const errors = events.filter((e): e is ClassifyError => !isMeasurement(e));
    const measurements = events.filter(isMeasurement);
    expect(measurements.map((m) => m.rule)).toEqual(["is_name_purposeful"]);
    expect(errors).toHaveLength(2); // NaN for is_vocabulary_consistent, missing is_greppable
    expect(errors[0]!.code).toBe("JEV_RESPONSE_INVALID");
    expect(errors[0]!.message).toContain("is_vocabulary_consistent");
    expect(errors[1]!.message).toContain("is_greppable");
  });

  test("classifier throwing ClassifyError -> streamed error with the same code", async () => {
    const classifier: Classifier = async () => {
      throw new ClassifyError("JEV_UNAVAILABLE", "src/a.ts", "jev unreachable: boom");
    };
    const events: (Measurement | ClassifyError)[] = [];
    for await (const event of classifyUnit(fileUnit, allSensors, classifier)) events.push(event);
    expect(events).toHaveLength(1);
    expect((events[0] as ClassifyError).code).toBe("JEV_UNAVAILABLE");
    expect((events[0] as ClassifyError).input).toBe("src/a.ts");
  });

  test("classifier throwing a plain Error -> INTERNAL error, never thrown past the pipeline", async () => {
    const classifier: Classifier = async () => {
      throw new Error("surprise");
    };
    const events: (Measurement | ClassifyError)[] = [];
    for await (const event of classifyUnit(fileUnit, allSensors, classifier)) events.push(event);
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
    const thrown = new ClassifyError("JEV_AUTH", "other.ts", "rejected");
    const error = toClassifyError("src/a.ts", thrown);
    expect(error.code).toBe("JEV_AUTH");
    expect(error.input).toBe("src/a.ts");
  });
});

describe("compileRuleQuestions — composite keys", () => {
  test("one state x many questions: keys stay '<rule> in <unitId>'", () => {
    const { questions } = compileRuleQuestions(
      [defaultRules.will_comment_drift!, defaultRules.is_comment_narration!],
      "a1b2c3d4",
    );
    expect(Object.keys(questions).sort()).toEqual([
      "is_comment_narration in a1b2c3d4",
      "will_comment_drift in a1b2c3d4",
    ]);
  });
});

describe("compileElementQuestions", () => {
  test("one element per call: question keys are bare rule names", () => {
    const questions = compileElementQuestions(
      [defaultRules.will_comment_drift!, defaultRules.is_cognitively_complex!],
      "comment",
    );
    expect(Object.keys(questions).sort()).toEqual(["is_cognitively_complex", "will_comment_drift"]);
    expect(questions.is_cognitively_complex!.type).toBe("score");
    expect(questions.is_cognitively_complex!.instructions).toBe(
      "This unit is a comment. " +
        (defaultRules.is_cognitively_complex! as { instructions: string }).instructions,
    );
    expect(questions.will_comment_drift!.type).toBe("noul");
    expect(questions.will_comment_drift!.instructions).toBe(
      "This unit is a comment. " +
        (defaultRules.will_comment_drift! as { instructions: string }).instructions,
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
    const { measurements, errors } = await classify(content, [defaultRules.is_name_purposeful!], {
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
  const fnRule = defaultRules.is_function_srp!; // functions-target: judges callables only

  test("a binding const gets a definitions-target measurement and zero functions-target ones", async () => {
    const { classifyFile } = await import("./classify.ts");
    const defRule = defaultRules.is_name_purposeful!; // definitions-target: judges const names too
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
    expect((classified[0]!.event as Measurement).rule).toBe("is_name_purposeful");
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
    expect((classified[0]!.event as Measurement).rule).toBe("is_function_srp");
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
  const fnRule = defaultRules.is_function_srp!;
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
    expect((classified[0]!.event as Measurement).rule).toBe("is_function_srp");
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
    expect(selectElement(inventory, { line: 4 })?.label).toBeUndefined();
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
