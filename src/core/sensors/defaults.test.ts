import { describe, test, expect } from "bun:test";
import { sensorDefaults } from "./defaults.ts";
import type { Sensor } from "../types.ts";

const CALIBRATION = "tests/data/calibration/healthy-baselines.json";
const SENSITIVITY = "tests/data/calibration/mutant-readings.json";

function severities(sensor: Sensor, values: number[]): (string | null)[] {
  return values.map((v) => sensor.handle(v));
}

describe("default handles: polarity", () => {
  test("naming sensors are high=good (error below threshold)", () => {
    expect(sensorDefaults.is_name_purposeful!.handle(0.1)).toBe("error");
    expect(sensorDefaults.is_name_purposeful!.handle(0.55)).toBe("warn");
    expect(sensorDefaults.is_name_purposeful!.handle(0.65)).toBeNull();
    expect(sensorDefaults.is_vocabulary_consistent!.handle(0.5)).toBe("error");
    expect(sensorDefaults.is_vocabulary_consistent!.handle(0.7)).toBe("warn");
    expect(sensorDefaults.is_vocabulary_consistent!.handle(0.8)).toBeNull();
    expect(sensorDefaults.is_naming_convention_consistent!.handle(0.6)).toBe("error");
    expect(sensorDefaults.is_naming_convention_consistent!.handle(0.75)).toBe("warn");
    expect(sensorDefaults.is_naming_convention_consistent!.handle(0.9)).toBeNull();
    expect(sensorDefaults.is_greppable!.handle(0.3)).toBe("error");
    expect(sensorDefaults.is_greppable!.handle(0.55)).toBe("error");
    expect(sensorDefaults.is_greppable!.handle(0.65)).toBe("warn");
    expect(sensorDefaults.is_greppable!.handle(0.8)).toBeNull();
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
    expect(sensorDefaults.is_cognitively_complex!.handle(0.7)).toBe("error");
    expect(sensorDefaults.is_cognitively_complex!.handle(0.5)).toBe("warn");
    expect(sensorDefaults.is_cognitively_complex!.handle(0.4)).toBeNull();
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
        if (value === undefined) continue; // fixture predates the sensor
        expect(typeof value).toBe("number");
        // Healthy code must never trip an ERROR; warns are legitimate nudges
        // (the self-lint corpus legitimately earns drift/consistency/
        // complexity warns on the files those claims describe).
        expect(sensor.handle(value!)).not.toBe("error");
      }
    }
  });

  test(`damaged readings fire their sensors at the right tier (consumer CI gate over a broken repo)`, async () => {
    const mutants = (await Bun.file(SENSITIVITY).json()) as Record<
      string,
      Record<string, number>
    > & { m3_comment_bloat_perfile: Record<string, Record<string, number>> };
    // m1_bad_names: naming collapses to errors
    expect(
      sensorDefaults.is_name_purposeful!.handle(mutants.m1_bad_names!.is_name_purposeful!),
    ).toBe("error");
    expect(
      sensorDefaults.is_vocabulary_consistent!.handle(
        mutants.m1_bad_names!.is_vocabulary_consistent!,
      ),
    ).toBe("error");
    expect(
      sensorDefaults.is_naming_convention_consistent!.handle(
        mutants.m1_bad_names!.is_naming_convention_consistent!,
      ),
    ).toBe("error");
    // m3_comment_bloat: pure narration noise. The whole-diff reading (0.27
    // under the multi-line claims) dilutes - the documented whole-diff
    // low-pass effect - so the claim is anchored where jint actually runs,
    // per file: the bloat slices read 0.46-0.52 against the healthy
    // 0.09-0.26 and fire is_comment_narration (5 errors, 2 null; the
    // sessions.ts slice has drawn 0.44-0.49, straddling the warn line).
    const m3Slices = Object.values(mutants.m3_comment_bloat_perfile!);
    expect(m3Slices.length).toBeGreaterThanOrEqual(6);
    const narrationSeverities = m3Slices.map((s) =>
      sensorDefaults.is_comment_narration!.handle(s.is_comment_narration!),
    );
    expect(narrationSeverities.filter((s) => s === "error").length).toBe(5);
    expect(narrationSeverities.filter((s) => s === null).length).toBe(2);
    // and the family's other attributes do not mistake bloat for their own claim
    expect(
      sensorDefaults.is_comment_patching_readability!.handle(
        mutants.m3_comment_bloat!.is_comment_patching_readability!,
      ),
    ).toBeNull();
    expect(
      sensorDefaults.will_comment_drift!.handle(mutants.m3_comment_bloat!.will_comment_drift!),
    ).toBeNull();
    // m4_obfuscate: warns across the naming family + complexity. The
    // precision reading straddles the 0.5 error line across draws
    // (0.45-0.52); the naming error tier is pinned by m1 above.
    const m4 = [
      sensorDefaults.is_name_purposeful!.handle(mutants.m4_obfuscate!.is_name_purposeful!),
      sensorDefaults.is_vocabulary_consistent!.handle(
        mutants.m4_obfuscate!.is_vocabulary_consistent!,
      ),
      sensorDefaults.is_cognitively_complex!.handle(mutants.m4_obfuscate!.is_cognitively_complex!),
    ];
    expect(m4.every((s) => s === "warn")).toBe(true);
    // casing stays its own lane on obfuscation: single-letter renames mix
    // forms for one kind, warn tier
    expect(
      sensorDefaults.is_naming_convention_consistent!.handle(
        mutants.m4_obfuscate!.is_naming_convention_consistent!,
      ),
    ).toBe("warn");
    // m2_strip_comments (removing comments) fires no comment/name errors.
    // Its greppable reading (0.64) predates the scoped description; under the
    // new thresholds it lands in warn, so the tier assertion is non-error.
    for (const sensor of Object.values(sensorDefaults)) {
      const severity = sensor.handle(mutants.m2_strip_comments![sensor.name]!);
      if (sensor.name === "is_greppable") {
        expect(severity).not.toBe("error");
      } else {
        expect(severity).toBeNull();
      }
    }
  });
});

describe("sensor definitions", () => {
  const sensorFires = (s: Sensor): boolean => s.handle(0.05) !== null || s.handle(0.95) !== null;

  test("every block-target sensor has a funnel sweep anchor and polarity", async () => {
    const funnel = await import("./funnel.ts");
    const SWEEP_THRESHOLDS = funnel.SWEEP_THRESHOLDS;
    const HIGH_GOOD = funnel.HIGH_GOOD;
    for (const sensor of Object.values(sensorDefaults)) {
      if (sensor.target === "files" || sensor.target === "imports" || sensor.target === "diffs")
        continue;
      const missing = Object.values(sensorDefaults)
        .filter((s) => s.target !== "files" && s.target !== "imports" && s.target !== "diffs")
        // a firing sensor without an anchor can never sweep -> never confirms; missing anchor
        .filter((s) => sensorFires(s) && typeof SWEEP_THRESHOLDS[s.name] !== "number");
      expect(missing.map((s) => s.name)).toEqual([]);
      // polarity: high-good handles fire on LOW values and are in HIGH_GOOD; high-bad the reverse
      const firesLow = sensor.handle(0.05) !== null;
      const firesHigh = sensor.handle(0.95) !== null;
      expect(HIGH_GOOD.has(sensor.name)).toBe(firesLow && !firesHigh);
    }
  });

  test("ten sensors with calibrated criteria rules", () => {
    const names = Object.keys(sensorDefaults);
    expect(names).toEqual([
      "is_name_purposeful",
      "is_vocabulary_consistent",
      "is_naming_convention_consistent",
      "is_greppable",
      "is_comment_business_context",
      "is_comment_narration",
      "is_comment_patching_readability",
      "will_comment_drift",
      "is_cognitively_complex",
      "is_function_srp",
    ]);
    for (const sensor of Object.values(sensorDefaults)) {
      expect(sensor.criteria.true.length).toBeGreaterThan(20);
      expect(sensor.criteria.false.length).toBeGreaterThan(20);
      expect(["files", "functions", "definitions", "comments", "imports", "diffs"]).toContain(
        sensor.target,
      );
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
