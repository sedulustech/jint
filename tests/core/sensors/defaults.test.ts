import { describe, test, expect } from "bun:test";
import { sensorDefaults } from "../../../src/core/sensors/defaults.ts";
import type { Sensor } from "../../../src/core/types.ts";

const CALIBRATION = "tests/data/calibration/healthy-baselines.json";
const SENSITIVITY = "tests/data/calibration/mutant-readings.json";

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
    expect(sensorDefaults.greppable_identifiers!.handle(0.55)).toBe("error");
    expect(sensorDefaults.greppable_identifiers!.handle(0.65)).toBe("warn");
    expect(sensorDefaults.greppable_identifiers!.handle(0.8)).toBeNull();
  });

  test("comment/complexity sensors are high=bad (error above threshold)", () => {
    expect(sensorDefaults.is_comment_narration!.handle(0.5)).toBe("error");
    expect(sensorDefaults.is_comment_narration!.handle(0.35)).toBe("warn");
    expect(sensorDefaults.is_comment_narration!.handle(0.25)).toBeNull();
    expect(sensorDefaults.is_comment_patching_readability!.handle(0.6)).toBe("error");
    expect(sensorDefaults.is_comment_patching_readability!.handle(0.45)).toBe("warn");
    expect(sensorDefaults.is_comment_patching_readability!.handle(0.35)).toBeNull();
    expect(sensorDefaults.will_comment_drift!.handle(0.75)).toBe("error");
    expect(sensorDefaults.will_comment_drift!.handle(0.6)).toBe("warn");
    expect(sensorDefaults.will_comment_drift!.handle(0.5)).toBeNull();
    expect(sensorDefaults.cognitive_complexity!.handle(0.7)).toBe("error");
    expect(sensorDefaults.cognitive_complexity!.handle(0.5)).toBe("warn");
    expect(sensorDefaults.cognitive_complexity!.handle(0.4)).toBeNull();
  });

  test("is_comment_business_context is gentle: null handle in v0 (absence is not a defect)", () => {
    for (const value of [0, 0.2, 0.5, 0.9, 1]) {
      expect(sensorDefaults.is_comment_business_context!.handle(value)).toBeNull();
    }
  });
});

describe("ci gate simulation: known-good corpus passes, damaged corpus fails", () => {
  test(`known-good readings produce no error-severity signals (consumer CI gate over a clean repo)`, async () => {
    const perFile = (await Bun.file(CALIBRATION).json()) as Record<string, Record<string, number>>;
    expect(Object.keys(perFile).length).toBeGreaterThan(0);
    for (const readings of Object.values(perFile)) {
      if (typeof readings !== "object" || readings === null) continue; // provenance notes
      for (const sensor of Object.values(sensorDefaults)) {
        const value = readings[sensor.name];
        expect(typeof value).toBe("number");
        // Healthy code must never trip an ERROR; warns are legitimate nudges
        // (e.g. keys.ts pins artifact names and earns a drift warn on purpose).
        expect(sensor.handle(value!)).not.toBe("error");
      }
    }
  });

  test(`damaged readings fire their sensors at the right tier (consumer CI gate over a broken repo)`, async () => {
    const mutants = (await Bun.file(SENSITIVITY).json()) as Record<string, Record<string, number>> &
      { m3_comment_bloat_perfile: Record<string, Record<string, number>> };
    // m1_bad_names: naming collapses to errors
    expect(sensorDefaults.naming_precision!.handle(mutants.m1_bad_names!.naming_precision!)).toBe("error");
    expect(sensorDefaults.naming_consistency!.handle(mutants.m1_bad_names!.naming_consistency!)).toBe("error");
    // m3_comment_bloat: pure narration noise. The whole-diff reading (0.23)
    // dilutes - the documented whole-diff low-pass effect - so the claim is
    // anchored where jint actually runs, per file: the bloat slices read
    // 0.47-0.56 against the healthy 0.09-0.19 and fire is_comment_narration.
    const m3Slices = Object.values(mutants.m3_comment_bloat_perfile!);
    expect(m3Slices.length).toBeGreaterThanOrEqual(6);
    const narrationSeverities = m3Slices.map((s) => sensorDefaults.is_comment_narration!.handle(s.is_comment_narration!));
    expect(narrationSeverities.filter((s) => s === "error").length).toBe(5);
    expect(narrationSeverities.filter((s) => s === null).length).toBe(2);
    // and the family's other attributes do not mistake bloat for their own claim
    expect(sensorDefaults.is_comment_patching_readability!.handle(mutants.m3_comment_bloat!.is_comment_patching_readability!)).toBeNull();
    expect(sensorDefaults.will_comment_drift!.handle(mutants.m3_comment_bloat!.will_comment_drift!)).toBeNull();
    // m4_obfuscate: warns across naming + complexity
    const m4 = [
      sensorDefaults.naming_precision!.handle(mutants.m4_obfuscate!.naming_precision!),
      sensorDefaults.naming_consistency!.handle(mutants.m4_obfuscate!.naming_consistency!),
      sensorDefaults.cognitive_complexity!.handle(mutants.m4_obfuscate!.cognitive_complexity!),
    ];
    expect(m4).toContain("warn");
    // m2_strip_comments (removing comments) fires no comment/name errors.
    // Its greppable reading (0.64) predates the scoped description; under the
    // new thresholds it lands in warn, so the tier assertion is non-error.
    for (const sensor of Object.values(sensorDefaults)) {
      const severity = sensor.handle(mutants.m2_strip_comments![sensor.name]!);
      if (sensor.name === "greppable_identifiers") {
        expect(severity).not.toBe("error");
      } else {
        expect(severity).toBeNull();
      }
    }
  });
});

describe("sensor definitions", () => {
  test("eight sensors with calibrated claim descriptions", () => {
    const names = Object.keys(sensorDefaults);
    expect(names).toEqual([
      "naming_precision",
      "naming_consistency",
      "greppable_identifiers",
      "is_comment_business_context",
      "is_comment_narration",
      "is_comment_patching_readability",
      "will_comment_drift",
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
