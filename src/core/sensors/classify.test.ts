import { describe, test, expect } from "bun:test";
import {
  MeasureError,
  type Classifier,
  type Measurement,
  type Rule,
  type Unit,
  type UnitState,
} from "../types.ts";
import {
  UNIT_TASK,
  elementWireId,
  compileRuleQuestions,
  compileElementQuestions,
  classifyUnit,
  toMeasureError,
} from "./classify.ts";
import { defaultRules } from "./defaults.ts";

const fileUnit: Unit = {
  kind: "file",
  state: {
    path: "src/a.ts",
    content: "export const x = 1;\n",
    id: elementWireId({ start: { line: 1 }, end: { line: 2 } }),
  },
};
const diffUnit: Unit = {
  kind: "diff",
  state: { path: "src/a.ts", diff: "@@ -1 +1 @@", commit_message: null },
};

const allSensors: readonly Rule[] = Object.values(defaultRules);

const FILE_ID = elementWireId({ start: { line: 1 }, end: { line: 2 } });

function classifierWith(values: Record<string, number>, calls: Unit[] = []): Classifier {
  return async (state, questions) => {
    calls.push({ kind: "file", state: state as UnitState });
    const out: Record<string, number> = {};
    for (const key of Object.keys(questions)) {
      // keys are "<rule> in <unitId>" (multi-rule) or the bare unitId (single rule)
      const rule = key.includes(" in ")
        ? key.slice(0, key.indexOf(" in "))
        : Object.keys(values)[0]!;
      if (rule in values) out[key] = values[rule]!;
    }
    return out;
  };
}

function isMeasurement(event: Measurement | MeasureError): event is Measurement {
  return "rule" in event;
}

describe("UNIT_TASK", () => {
  test("the calibrated task sentence is byte-exact", () => {
    // WHY the word Judge stays: this string is calibration surface, not code naming —
    // thresholds and baselines were measured with exactly this prompt. Renames apply to
    // identifiers, never to prompt strings (the sensor->rule rename once rewrote it to
    // "Classifier the ...", silently mutating every reading). Pin it byte-exact.
    expect(UNIT_TASK).toBe("Judge the syntax unit against the criteria.");
  });
});

describe("compileRuleQuestions", () => {
  test("whole-file unit: criteria passthrough, instructions is the task sentence", () => {
    const rule = defaultRules.is_name_purposeful!;
    const { questions, attribution } = compileRuleQuestions([rule], FILE_ID);
    const spec = questions[`is_name_purposeful in ${FILE_ID}`]!;
    expect(spec.type).toBe("noul");
    expect(spec.instructions).toBe(UNIT_TASK);
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
    expect(spec.instructions).toBe(UNIT_TASK);
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
        is_readable: 1,
        will_error_lose_cause: 0.2,
      },
      calls,
    );
    const events: (Measurement | MeasureError)[] = [];
    for await (const event of classifyUnit(fileUnit, allSensors, classifier)) events.push(event);
    expect(events).toHaveLength(11);
    expect(events.every(isMeasurement)).toBe(true);
    expect((events as Measurement[]).map((m) => m.rule)).toContain("is_name_purposeful");
    expect(calls).toHaveLength(1); // one batched call, not nine
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
    const events: (Measurement | MeasureError)[] = [];
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
    const errors = events.filter((e): e is MeasureError => !isMeasurement(e));
    const measurements = events.filter(isMeasurement);
    expect(measurements.map((m) => m.rule)).toEqual(["is_name_purposeful"]);
    expect(errors).toHaveLength(2); // NaN for is_vocabulary_consistent, missing is_greppable
    expect(errors[0]!.code).toBe("JEV_RESPONSE_INVALID");
    expect(errors[0]!.message).toContain("is_vocabulary_consistent");
    expect(errors[1]!.message).toContain("is_greppable");
  });

  test("classifier throwing MeasureError -> streamed error with the same code", async () => {
    const classifier: Classifier = async () => {
      throw new MeasureError("JEV_UNAVAILABLE", "src/a.ts", "jev unreachable: boom");
    };
    const events: (Measurement | MeasureError)[] = [];
    for await (const event of classifyUnit(fileUnit, allSensors, classifier)) events.push(event);
    expect(events).toHaveLength(1);
    expect((events[0] as MeasureError).code).toBe("JEV_UNAVAILABLE");
    expect((events[0] as MeasureError).input).toBe("src/a.ts");
  });

  test("classifier throwing a plain Error -> INTERNAL error, never thrown past the pipeline", async () => {
    const classifier: Classifier = async () => {
      throw new Error("surprise");
    };
    const events: (Measurement | MeasureError)[] = [];
    for await (const event of classifyUnit(diffUnit, allSensors, classifier)) events.push(event);
    expect((events[0] as MeasureError).code).toBe("INTERNAL");
  });

  test("no rules -> classifier never called", async () => {
    let called = false;
    const classifier: Classifier = async () => {
      called = true;
      return {};
    };
    const events: (Measurement | MeasureError)[] = [];
    for await (const event of classifyUnit(fileUnit, [], classifier)) {
      events.push(event);
    }
    expect(called).toBe(false);
    expect(events).toHaveLength(0);
  });
});

describe("toMeasureError", () => {
  test("non-Error throwables become INTERNAL errors", () => {
    const error = toMeasureError(fileUnit.state.path, "a string was thrown");
    expect(error.code).toBe("INTERNAL");
    expect(error.message).toBe("a string was thrown");
    expect(error.input).toBe("src/a.ts");
  });

  test("a plain Error chains the original as cause", () => {
    const thrown = new Error("socket hang up");
    const error = toMeasureError("src/a.ts", thrown);
    expect(error.code).toBe("INTERNAL");
    expect(error.message).toBe("socket hang up");
    expect(error.cause).toBe(thrown);
  });

  test("a thrown MeasureError keeps its code; input is refined", () => {
    const thrown = new MeasureError("JEV_AUTH", "other.ts", "rejected");
    const error = toMeasureError("src/a.ts", thrown);
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
    const questions = compileElementQuestions([
      defaultRules.will_comment_drift!,
      defaultRules.is_readable!,
    ]);
    expect(Object.keys(questions).sort()).toEqual(["is_readable", "will_comment_drift"]);
    expect(questions.is_readable!.type).toBe("score");
    expect(questions.is_readable!.instructions).toBe(
      (defaultRules.is_readable! as { instructions: string }).instructions,
    );
    expect(questions.will_comment_drift!.type).toBe("noul");
    expect(questions.will_comment_drift!.instructions).toBe(UNIT_TASK);
  });
});

describe("classifyFile — element fan-out", () => {
  test("one element per call, bounded concurrency (the array matrix state is banned)", async () => {
    const { classifyFile, ELEMENT_CONCURRENCY } = await import("./classify.ts");
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
      return Object.fromEntries(Object.keys(questions).map((k) => [k, 0.5]));
    };
    const { events } = await classifyFile(
      { kind: "file", state: { path: "src/gen.ts", content, id: "L1-L13" } },
      [defaultRules.is_name_purposeful!],
      classifier,
    );
    expect(events).toHaveLength(12);
    expect(events.every((e) => !(e.event instanceof MeasureError))).toBe(true);
    expect(maxInFlight).toBeLessThanOrEqual(ELEMENT_CONCURRENCY);
    expect(maxInFlight).toBeGreaterThan(1); // concurrent, not sequential
  });
});

describe("classifyFile — role routing", () => {
  const fnRule = defaultRules.is_function_srp!; // functions-target: judges callables only

  test("a data const gets no functions-target measurement", async () => {
    const { classifyFile } = await import("./classify.ts");
    const classifier: Classifier = async (_state, questions) =>
      Object.fromEntries(Object.keys(questions).map((k) => [k, 0.5]));
    const { events } = await classifyFile(
      {
        kind: "file",
        state: { path: "src/data.ts", content: "const report = buildReport();\n", id: "L1" },
      },
      [fnRule],
      classifier,
    );
    const measured = events.filter((e) => !(e.event instanceof MeasureError));
    expect(measured).toHaveLength(0);
  });

  test("an arrow-function const still gets the functions-target measurement", async () => {
    const { classifyFile } = await import("./classify.ts");
    const classifier: Classifier = async (_state, questions) =>
      Object.fromEntries(Object.keys(questions).map((k) => [k, 0.5]));
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
    const measured = events.filter((e) => !(e.event instanceof MeasureError));
    expect(measured).toHaveLength(1);
    expect((measured[0]!.event as Measurement).rule).toBe("is_function_srp");
  });
});
