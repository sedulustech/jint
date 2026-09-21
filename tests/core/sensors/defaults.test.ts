import { describe, test, expect } from "bun:test";
import { sensorDefaults } from "../../../src/core/sensors/defaults.ts";
import type { Sensor } from "../../../src/core/types.ts";

const CALIBRATION = "tmp/diff-v4/diff_v4_perfile.json";
const SENSITIVITY = "tmp/diff-v4/diff_v4_sensitivity.json";

function severities(sensor: Sensor, values: number[]): (string | null)[] {
  return values.map((v) => sensor.handle(v));
}

describe("default handles: polarity", () => {
  test("naming sensors are high=good (error below threshold)", () => {
    expect(sensorDefaults.naming_precision!.handle(0.1)).toBe("error");
    expect(sensorDefaults.naming_precision!.handle(0.45)).toBe("warn");
    expect(sensorDefaults.naming_precision!.handle(0.6)).toBeNull();
    expect(sensorDefaults.naming_consistency!.handle(0.5)).toBe("error");
    expect(sensorDefaults.naming_consistency!.handle(0.8)).toBe("warn");
    expect(sensorDefaults.naming_consistency!.handle(0.9)).toBeNull();
    expect(sensorDefaults.greppable_identifiers!.handle(0.3)).toBe("error");
    expect(sensorDefaults.greppable_identifiers!.handle(0.5)).toBe("warn");
    expect(sensorDefaults.greppable_identifiers!.handle(0.56)).toBeNull();
  });

  test("comment/complexity sensors are high=bad (error above threshold)", () => {
    expect(sensorDefaults.excessive_comments!.handle(0.7)).toBe("error");
    expect(sensorDefaults.excessive_comments!.handle(0.5)).toBe("warn");
    expect(sensorDefaults.excessive_comments!.handle(0.3)).toBeNull();
    expect(sensorDefaults.cognitive_complexity!.handle(0.7)).toBe("error");
    expect(sensorDefaults.cognitive_complexity!.handle(0.5)).toBe("warn");
    expect(sensorDefaults.cognitive_complexity!.handle(0.4)).toBeNull();
  });
});

describe("calibration: healthy baselines must yield zero signals", () => {
  test(`every file in ${CALIBRATION} passes all five handles silently`, async () => {
    if (!(await Bun.file(CALIBRATION).exists())) return; // calibration artifacts live in gitignored tmp/
    const perFile = (await Bun.file(CALIBRATION).json()) as Record<string, Record<string, number>>;
    expect(Object.keys(perFile).length).toBeGreaterThan(0);
    for (const readings of Object.values(perFile)) {
      for (const sensor of Object.values(sensorDefaults)) {
        const value = readings[sensor.name];
        expect(typeof value).toBe("number");
        expect(sensor.handle(value!)).toBeNull();
      }
    }
  });

  test(`mutants in ${SENSITIVITY} are caught by the right sensor tier`, async () => {
    if (!(await Bun.file(SENSITIVITY).exists())) return;
    const mutants = (await Bun.file(SENSITIVITY).json()) as Record<string, Record<string, number>>;
    // m1_bad_names: naming collapses to errors
    expect(sensorDefaults.naming_precision!.handle(mutants.m1_bad_names!.naming_precision!)).toBe("error");
    expect(sensorDefaults.naming_consistency!.handle(mutants.m1_bad_names!.naming_consistency!)).toBe("error");
    // m3_comment_bloat: excessive_comments fires error
    expect(sensorDefaults.excessive_comments!.handle(mutants.m3_comment_bloat!.excessive_comments!)).toBe("error");
    // m4_obfuscate: warns across naming + complexity
    const m4 = [
      sensorDefaults.naming_precision!.handle(mutants.m4_obfuscate!.naming_precision!),
      sensorDefaults.naming_consistency!.handle(mutants.m4_obfuscate!.naming_consistency!),
      sensorDefaults.cognitive_complexity!.handle(mutants.m4_obfuscate!.cognitive_complexity!),
    ];
    expect(m4).toContain("warn");
    // m2_strip_comments (removing comments) is healthy: nothing fires
    for (const sensor of Object.values(sensorDefaults)) {
      expect(sensor.handle(mutants.m2_strip_comments![sensor.name]!)).toBeNull();
    }
  });
});

describe("sensor definitions", () => {
  test("five sensors with calibrated claim descriptions", () => {
    const names = Object.keys(sensorDefaults);
    expect(names).toEqual([
      "naming_precision",
      "naming_consistency",
      "greppable_identifiers",
      "excessive_comments",
      "cognitive_complexity",
    ]);
    for (const sensor of Object.values(sensorDefaults)) {
      expect(sensor.description.length).toBeGreaterThan(20);
      expect(sensor.inputTypes).toEqual(["file", "diff"]);
    }
  });

  test("handles return only error|warn|null", () => {
    const sampleValues = [0, 0.25, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.85, 0.9, 1];
    for (const sensor of Object.values(sensorDefaults)) {
      for (const severity of severities(sensor, sampleValues)) {
        expect(["error", "warn", null]).toContain(severity);
      }
    }
  });
});
