import { describe, test, expect } from "bun:test";
import {
  RequestError,
  type Judge,
  type Measurement,
  type Sensor,
  type Unit,
  type UnitState,
} from "../types.ts";
import { sensorDefaults } from "./defaults.ts";
import {
  UNIT_TASK,
  blockWireId,
  compileSensorQuestions,
  measureUnit,
  toRequestError,
} from "./measure.ts";

const fileUnit: Unit = {
  kind: "file",
  state: {
    path: "src/a.ts",
    content: "export const x = 1;\n",
    id: blockWireId("export const x = 1;\n"),
  },
};
const diffUnit: Unit = {
  kind: "diff",
  state: { path: "src/a.ts", diff: "@@ -1 +1 @@", commit_message: null },
};

const allSensors: readonly Sensor[] = Object.values(sensorDefaults);

const FILE_ID = blockWireId("export const x = 1;\n");

function judgeWith(values: Record<string, number>, calls: Unit[] = []): Judge {
  return async (state, questions) => {
    calls.push({ kind: "file", state: state as UnitState });
    const out: Record<string, number> = {};
    for (const key of Object.keys(questions)) {
      // keys are "<sensor> in <unitId>" (multi-sensor) or the bare unitId (single sensor)
      const sensor = key.includes(" in ")
        ? key.slice(0, key.indexOf(" in "))
        : Object.keys(values)[0]!;
      if (sensor in values) out[key] = values[sensor]!;
    }
    return out;
  };
}

function isMeasurement(event: Measurement | RequestError): event is Measurement {
  return "sensor" in event;
}

describe("compileSensorQuestions", () => {
  test("whole-file unit: criteria passthrough, instructions maps the unit id to the task sentence", () => {
    const sensor = sensorDefaults.is_name_purposeful!;
    const { questions, attribution } = compileSensorQuestions([sensor], FILE_ID);
    const spec = questions[FILE_ID]!;
    expect(spec.type).toBe("noul");
    expect(spec.instructions).toEqual({ [FILE_ID]: UNIT_TASK });
    expect(spec.criteria).toBe(sensor.criteria);
    expect(attribution.get(FILE_ID)).toEqual({
      sensor: "is_name_purposeful",
      blockId: FILE_ID,
    });
  });

  test("block-scoped: '<sensor> in <unitId>' ids, wire id keyed in instructions", () => {
    const sensor = sensorDefaults.is_name_purposeful!;
    const { questions, attribution } = compileSensorQuestions([sensor], "block-3");
    const spec = questions["block-3"]!;
    expect(spec.instructions).toEqual({ "block-3": UNIT_TASK });
    expect(spec.criteria).toBe(sensor.criteria);
    expect(attribution.get("block-3")).toEqual({
      sensor: "is_name_purposeful",
      blockId: "block-3",
    });
  });

  test("blockWireId: full LOC interval of the content", () => {
    expect(blockWireId("export const x = 1;\n")).toBe("L1-L2");
    expect(blockWireId("a\nb\nc")).toBe("L1-L3");
    expect(blockWireId("a")).toBe("L1-L1");
  });
});

describe("measureUnit", () => {
  test("ONE batched judge call per unit; one measurement per sensor", async () => {
    const calls: Unit[] = [];
    const judge = judgeWith(
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
      },
      calls,
    );
    const events: (Measurement | RequestError)[] = [];
    for await (const event of measureUnit(fileUnit, allSensors, judge)) events.push(event);
    expect(events).toHaveLength(9);
    expect(events.every(isMeasurement)).toBe(true);
    expect((events as Measurement[]).map((m) => m.sensor)).toContain("is_name_purposeful");
    expect(calls).toHaveLength(1); // one batched call, not nine
  });

  test("values pass through untouched", async () => {
    const judge = judgeWith({ is_name_purposeful: 0.5347219 });
    for await (const event of measureUnit(fileUnit, [sensorDefaults.is_name_purposeful!], judge)) {
      expect(isMeasurement(event) && event.value).toBe(0.5347219);
    }
  });

  test("missing or non-finite answer -> JEV_RESPONSE_INVALID error, siblings continue", async () => {
    const judge = judgeWith({ is_name_purposeful: 0.7, is_vocabulary_consistent: Number.NaN });
    const events: (Measurement | RequestError)[] = [];
    for await (const event of measureUnit(
      fileUnit,
      [
        sensorDefaults.is_name_purposeful!,
        sensorDefaults.is_vocabulary_consistent!,
        sensorDefaults.is_greppable!,
      ],
      judge,
    )) {
      events.push(event);
    }
    const errors = events.filter((e): e is RequestError => !isMeasurement(e));
    const measurements = events.filter(isMeasurement);
    expect(measurements.map((m) => m.sensor)).toEqual(["is_name_purposeful"]);
    expect(errors).toHaveLength(2); // NaN for is_vocabulary_consistent, missing is_greppable
    expect(errors[0]!.code).toBe("JEV_RESPONSE_INVALID");
    expect(errors[0]!.message).toContain("is_vocabulary_consistent");
    expect(errors[1]!.message).toContain("is_greppable");
  });

  test("judge throwing RequestError -> streamed error with the same code", async () => {
    const judge: Judge = async () => {
      throw new RequestError("JEV_UNAVAILABLE", "src/a.ts", "jev unreachable: boom");
    };
    const events: (Measurement | RequestError)[] = [];
    for await (const event of measureUnit(fileUnit, allSensors, judge)) events.push(event);
    expect(events).toHaveLength(1);
    expect((events[0] as RequestError).code).toBe("JEV_UNAVAILABLE");
    expect((events[0] as RequestError).input).toBe("src/a.ts");
  });

  test("judge throwing a plain Error -> INTERNAL error, never thrown past the pipeline", async () => {
    const judge: Judge = async () => {
      throw new Error("surprise");
    };
    const events: (Measurement | RequestError)[] = [];
    for await (const event of measureUnit(diffUnit, allSensors, judge)) events.push(event);
    expect((events[0] as RequestError).code).toBe("INTERNAL");
  });

  test("no sensors -> judge never called", async () => {
    let called = false;
    const judge: Judge = async () => {
      called = true;
      return {};
    };
    const events: (Measurement | RequestError)[] = [];
    for await (const event of measureUnit(fileUnit, [], judge)) {
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

describe("compileSensorQuestions — single-sensor bare keys", () => {
  test("with one sensor, question keys are the bare unit id (no composite key)", () => {
    const { questions, attribution } = compileSensorQuestions(
      [sensorDefaults.will_comment_drift!],
      "a1b2c3d4",
    );
    const keys = Object.keys(questions);
    expect(keys).toEqual(["a1b2c3d4"]);
    expect(attribution.get("a1b2c3d4")).toEqual({
      sensor: "will_comment_drift",
      blockId: "a1b2c3d4",
    });
  });

  test("with multiple sensors, keys stay composite", () => {
    const { questions } = compileSensorQuestions(
      [sensorDefaults.will_comment_drift!, sensorDefaults.is_comment_narration!],
      "a1b2c3d4",
    );
    expect(Object.keys(questions).sort()).toEqual([
      "is_comment_narration in a1b2c3d4",
      "will_comment_drift in a1b2c3d4",
    ]);
  });
});
