import { describe, test, expect } from "bun:test";
import {
  AppError,
  type Judge,
  type Measurement,
  type Diagnostic,
  type Sensor,
  type Unit,
} from "../types.ts";
import { sensorDefaults } from "./defaults.ts";
import { selectSensors, compileSensorQuestions, measureUnit, toDiagnostic } from "./measure.ts";

const fileUnit: Unit = {
  kind: "file",
  state: { path: "src/a.ts", content: "export const x = 1;\n" },
};
const diffUnit: Unit = {
  kind: "diff",
  state: { path: "src/a.ts", diff: "@@ -1 +1 @@", commit_message: null },
};

const allSensors: readonly Sensor[] = Object.values(sensorDefaults);

function judgeWith(values: Record<string, number>, calls: Unit[] = []): Judge {
  return async (state) => {
    calls.push({ kind: "file", state });
    return values;
  };
}

function isMeasurement(event: Measurement | Diagnostic): event is Measurement {
  return "sensor" in event;
}

describe("selectSensors", () => {
  test("kind narrows the sensor set", () => {
    expect(selectSensors(allSensors, "file")).toHaveLength(9);
    expect(selectSensors(allSensors, "diff")).toHaveLength(9);
    expect(selectSensors([{ ...allSensors[0]!, inputTypes: ["file"] }], "diff")).toHaveLength(0);
  });
});

describe("compileSensorQuestions", () => {
  test("uses the calibrated structured envelope", () => {
    const questions = compileSensorQuestions([sensorDefaults.is_name_purposeful!]);
    expect(questions.is_name_purposeful!.type).toBe("noul");
    const instructions = questions.is_name_purposeful!.instructions as Record<string, string>;
    expect(instructions.role).toBe("measurement");
    expect(instructions.dimension).toBe("is_name_purposeful");
    expect(instructions.claim).toBe(sensorDefaults.is_name_purposeful!.description);
    expect(instructions.true_means).toBe("the property holds in the added code");
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
    const events: (Measurement | Diagnostic)[] = [];
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

  test("missing or non-finite answer -> JEV_RESPONSE_INVALID diagnostic, siblings continue", async () => {
    const judge = judgeWith({ is_name_purposeful: 0.7, is_vocabulary_consistent: Number.NaN });
    const events: (Measurement | Diagnostic)[] = [];
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
    const diagnostics = events.filter((e): e is Diagnostic => !isMeasurement(e));
    const measurements = events.filter(isMeasurement);
    expect(measurements.map((m) => m.sensor)).toEqual(["is_name_purposeful"]);
    expect(diagnostics).toHaveLength(2); // NaN for is_vocabulary_consistent, missing is_greppable
    expect(diagnostics[0]!.code).toBe("JEV_RESPONSE_INVALID");
    expect(diagnostics[0]!.message).toContain("is_vocabulary_consistent");
    expect(diagnostics[1]!.message).toContain("is_greppable");
  });

  test("judge throwing AppError -> diagnostic with the same code", async () => {
    const judge: Judge = async () => {
      throw new AppError("JEV_UNAVAILABLE", "jev unreachable: boom");
    };
    const events: (Measurement | Diagnostic)[] = [];
    for await (const event of measureUnit(fileUnit, allSensors, judge)) events.push(event);
    expect(events).toHaveLength(1);
    expect((events[0] as Diagnostic).code).toBe("JEV_UNAVAILABLE");
    expect((events[0] as Diagnostic).input).toBe("src/a.ts");
  });

  test("judge throwing a plain Error -> INTERNAL diagnostic, never thrown past the pipeline", async () => {
    const judge: Judge = async () => {
      throw new Error("surprise");
    };
    const events: (Measurement | Diagnostic)[] = [];
    for await (const event of measureUnit(diffUnit, allSensors, judge)) events.push(event);
    expect((events[0] as Diagnostic).code).toBe("INTERNAL");
  });

  test("no input-compatible sensors -> judge never called", async () => {
    let called = false;
    const judge: Judge = async () => {
      called = true;
      return {};
    };
    const events: (Measurement | Diagnostic)[] = [];
    for await (const event of measureUnit(
      fileUnit,
      [{ ...sensorDefaults.is_name_purposeful!, inputTypes: ["diff"] }],
      judge,
    )) {
      events.push(event);
    }
    expect(called).toBe(false);
    expect(events).toHaveLength(0);
  });
});

describe("toDiagnostic", () => {
  test("non-Error throwables become INTERNAL diagnostics", () => {
    const diagnostic = toDiagnostic(fileUnit, "a string was thrown");
    expect(diagnostic.code).toBe("INTERNAL");
    expect(diagnostic.message).toBe("a string was thrown");
  });
});
