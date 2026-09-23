import { describe, test, expect } from "bun:test";
import {
  RequestError,
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
  classifyUnit,
  toRequestError,
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

function isMeasurement(event: Measurement | RequestError): event is Measurement {
  return "rule" in event;
}

describe("compileRuleQuestions", () => {
  test("whole-file unit: criteria passthrough, instructions maps the unit id to the task sentence", () => {
    const rule = defaultRules.is_name_purposeful!;
    const { questions, attribution } = compileRuleQuestions([rule], FILE_ID);
    const spec = questions[FILE_ID]!;
    expect(spec.type).toBe("noul");
    expect(spec.instructions).toEqual({ [FILE_ID]: UNIT_TASK });
    expect(spec.criteria).toBe(rule.criteria);
    expect(attribution.get(FILE_ID)).toEqual({
      rule: "is_name_purposeful",
      blockId: FILE_ID,
    });
  });

  test("block-scoped: '<rule> in <unitId>' ids, wire id keyed in instructions", () => {
    const rule = defaultRules.is_name_purposeful!;
    const { questions, attribution } = compileRuleQuestions([rule], "block-3");
    const spec = questions["block-3"]!;
    expect(spec.instructions).toEqual({ "block-3": UNIT_TASK });
    expect(spec.criteria).toBe(rule.criteria);
    expect(attribution.get("block-3")).toEqual({
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
        is_comment_business_context: 0.5,
        is_comment_narration: 0.2,
        is_comment_patching_readability: 0.1,
        will_comment_drift: 0.1,
        is_cognitively_complex: 0.3,
        is_function_srp: 0.8,
      },
      calls,
    );
    const events: (Measurement | RequestError)[] = [];
    for await (const event of classifyUnit(fileUnit, allSensors, classifier)) events.push(event);
    expect(events).toHaveLength(10);
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
    const events: (Measurement | RequestError)[] = [];
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
    const errors = events.filter((e): e is RequestError => !isMeasurement(e));
    const measurements = events.filter(isMeasurement);
    expect(measurements.map((m) => m.rule)).toEqual(["is_name_purposeful"]);
    expect(errors).toHaveLength(2); // NaN for is_vocabulary_consistent, missing is_greppable
    expect(errors[0]!.code).toBe("JEV_RESPONSE_INVALID");
    expect(errors[0]!.message).toContain("is_vocabulary_consistent");
    expect(errors[1]!.message).toContain("is_greppable");
  });

  test("classifier throwing RequestError -> streamed error with the same code", async () => {
    const classifier: Classifier = async () => {
      throw new RequestError("JEV_UNAVAILABLE", "src/a.ts", "jev unreachable: boom");
    };
    const events: (Measurement | RequestError)[] = [];
    for await (const event of classifyUnit(fileUnit, allSensors, classifier)) events.push(event);
    expect(events).toHaveLength(1);
    expect((events[0] as RequestError).code).toBe("JEV_UNAVAILABLE");
    expect((events[0] as RequestError).input).toBe("src/a.ts");
  });

  test("classifier throwing a plain Error -> INTERNAL error, never thrown past the pipeline", async () => {
    const classifier: Classifier = async () => {
      throw new Error("surprise");
    };
    const events: (Measurement | RequestError)[] = [];
    for await (const event of classifyUnit(diffUnit, allSensors, classifier)) events.push(event);
    expect((events[0] as RequestError).code).toBe("INTERNAL");
  });

  test("no rules -> classifier never called", async () => {
    let called = false;
    const classifier: Classifier = async () => {
      called = true;
      return {};
    };
    const events: (Measurement | RequestError)[] = [];
    for await (const event of classifyUnit(fileUnit, [], classifier)) {
      events.push(event);
    }
    expect(called).toBe(false);
    expect(events).toHaveLength(0);
  });
});

describe("toRequestError", () => {
  test("non-Error throwables become INTERNAL errors", () => {
    const error = toRequestError(fileUnit.state.path, "a string was thrown");
    expect(error.code).toBe("INTERNAL");
    expect(error.message).toBe("a string was thrown");
    expect(error.input).toBe("src/a.ts");
  });

  test("a thrown RequestError keeps its code; input is refined", () => {
    const thrown = new RequestError("JEV_AUTH", "other.ts", "rejected");
    const error = toRequestError("src/a.ts", thrown);
    expect(error.code).toBe("JEV_AUTH");
    expect(error.input).toBe("src/a.ts");
  });
});

describe("compileRuleQuestions — single-rule bare keys", () => {
  test("with one rule, question keys are the bare unit id (no composite key)", () => {
    const { questions, attribution } = compileRuleQuestions(
      [defaultRules.will_comment_drift!],
      "a1b2c3d4",
    );
    const keys = Object.keys(questions);
    expect(keys).toEqual(["a1b2c3d4"]);
    expect(attribution.get("a1b2c3d4")).toEqual({
      rule: "will_comment_drift",
      blockId: "a1b2c3d4",
    });
  });

  test("with multiple rules, keys stay composite", () => {
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
