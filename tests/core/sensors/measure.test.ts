import { describe, test, expect } from "bun:test";
import { selectSensors, compileSensorQuestions, measureUnit, toDiagnostic } from "../../../src/core/sensors/measure.ts";
import { sensorDefaults } from "../../../src/core/sensors/defaults.ts";
import { AppError, type Judge, type Measurement, type Diagnostic, type Sensor, type Unit } from "../../../src/core/types.ts";

const fileUnit: Unit = { kind: "file", state: { path: "src/a.ts", content: "export const x = 1;\n" } };
const diffUnit: Unit = { kind: "diff", state: { path: "src/a.ts", diff: "@@ -1 +1 @@", commit_message: null } };

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
    expect(selectSensors(allSensors, "file")).toHaveLength(8);
    expect(selectSensors(allSensors, "diff")).toHaveLength(8);
    expect(selectSensors([{ ...allSensors[0]!, inputTypes: ["file"] }], "diff")).toHaveLength(0);
  });
});

describe("compileSensorQuestions", () => {
  test("uses the calibrated structured envelope", () => {
    const questions = compileSensorQuestions([sensorDefaults.naming_precision!]);
    expect(questions.naming_precision!.type).toBe("noul");
    const instructions = questions.naming_precision!.instructions as Record<string, string>;
    expect(instructions.role).toBe("measurement");
    expect(instructions.dimension).toBe("naming_precision");
    expect(instructions.claim).toBe(sensorDefaults.naming_precision!.description);
    expect(instructions.true_means).toBe("the property holds in the added code");
  });
});

describe("measureUnit", () => {
  test("ONE batched judge call per unit; one measurement per sensor", async () => {
    const calls: Unit[] = [];
    const judge = judgeWith({ naming_precision: 0.7, naming_consistency: 0.8, greppable_identifiers: 0.6, is_comment_business_context: 0.5, is_comment_narration: 0.2, is_comment_patching_readability: 0.1, will_comment_drift: 0.1, cognitive_complexity: 0.3 }, calls);
    const events: (Measurement | Diagnostic)[] = [];
    for await (const event of measureUnit(fileUnit, allSensors, judge)) events.push(event);
    expect(events).toHaveLength(8);
    expect(events.every(isMeasurement)).toBe(true);
    expect((events as Measurement[]).map((m) => m.sensor)).toContain("naming_precision");
    expect(calls).toHaveLength(1); // one batched call, not eight
  });

  test("values pass through untouched", async () => {
    const judge = judgeWith({ naming_precision: 0.5347219 });
    for await (const event of measureUnit(fileUnit, [sensorDefaults.naming_precision!], judge)) {
      expect(isMeasurement(event) && event.value).toBe(0.5347219);
    }
  });

  test("missing or non-finite answer -> JEV_RESPONSE_INVALID diagnostic, siblings continue", async () => {
    const judge = judgeWith({ naming_precision: 0.7, naming_consistency: Number.NaN });
    const events: (Measurement | Diagnostic)[] = [];
    for await (const event of measureUnit(fileUnit, [sensorDefaults.naming_precision!, sensorDefaults.naming_consistency!, sensorDefaults.greppable_identifiers!], judge)) {
      events.push(event);
    }
    const diagnostics = events.filter((e): e is Diagnostic => !isMeasurement(e));
    const measurements = events.filter(isMeasurement);
    expect(measurements.map((m) => m.sensor)).toEqual(["naming_precision"]);
    expect(diagnostics).toHaveLength(2); // NaN for naming_consistency, missing greppable_identifiers
    expect(diagnostics[0]!.code).toBe("JEV_RESPONSE_INVALID");
    expect(diagnostics[0]!.message).toContain("naming_consistency");
    expect(diagnostics[1]!.message).toContain("greppable_identifiers");
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
    for await (const event of measureUnit(fileUnit, [{ ...sensorDefaults.naming_precision!, inputTypes: ["diff"] }], judge)) {
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
