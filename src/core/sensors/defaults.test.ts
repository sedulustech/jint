import { describe, test, expect } from "bun:test";
import { defaultRules } from "./defaults.ts";
import type { Rule } from "../types.ts";

const CALIBRATION = "tests/data/calibration/healthy-baselines.json";
const SENSITIVITY = "tests/data/calibration/mutant-readings.json";

function severities(rule: Rule, values: number[]): (string | null)[] {
  return values.map((v) => rule.handle(v));
}

describe("default handles: polarity", () => {
  test("naming rules are high=good (error below threshold)", () => {
    expect(defaultRules.is_name_purposeful!.handle(0.1)).toBe("error");
    expect(defaultRules.is_name_purposeful!.handle(0.55)).toBe("warn");
    expect(defaultRules.is_name_purposeful!.handle(0.65)).toBeNull();
    expect(defaultRules.is_vocabulary_consistent!.handle(0.5)).toBe("error");
    expect(defaultRules.is_vocabulary_consistent!.handle(0.7)).toBe("warn");
    expect(defaultRules.is_vocabulary_consistent!.handle(0.8)).toBeNull();
    expect(defaultRules.is_naming_convention_consistent!.handle(0.6)).toBe("error");
    expect(defaultRules.is_naming_convention_consistent!.handle(0.75)).toBe("warn");
    expect(defaultRules.is_naming_convention_consistent!.handle(0.9)).toBeNull();
    expect(defaultRules.is_greppable!.handle(0.3)).toBe("error");
    expect(defaultRules.is_greppable!.handle(0.55)).toBe("error");
    expect(defaultRules.is_greppable!.handle(0.65)).toBe("warn");
    expect(defaultRules.is_greppable!.handle(0.8)).toBeNull();
  });

  test("comment/complexity rules are high=bad (error above threshold)", () => {
    expect(defaultRules.is_comment_narration!.handle(0.5)).toBe("error");
    expect(defaultRules.is_comment_narration!.handle(0.35)).toBe("warn");
    expect(defaultRules.is_comment_narration!.handle(0.25)).toBeNull();
    expect(defaultRules.is_comment_patching_readability!.handle(0.6)).toBe("error");
    expect(defaultRules.is_comment_patching_readability!.handle(0.45)).toBe("warn");
    expect(defaultRules.is_comment_patching_readability!.handle(0.35)).toBeNull();
    expect(defaultRules.will_comment_drift!.handle(0.75)).toBe("error");
    expect(defaultRules.will_comment_drift!.handle(0.6)).toBe("warn");
    expect(defaultRules.will_comment_drift!.handle(0.5)).toBeNull();
    expect(defaultRules.is_cognitively_complex!.handle(0.7)).toBe("error");
    expect(defaultRules.is_cognitively_complex!.handle(0.5)).toBe("warn");
    expect(defaultRules.is_cognitively_complex!.handle(0.4)).toBeNull();
  });
});

describe("ci gate simulation: known-good corpus passes, damaged corpus fails", () => {
  test(`known-good readings produce no error-severity signals (consumer CI gate over a clean repo)`, async () => {
    const perFile = (await Bun.file(CALIBRATION).json()) as Record<string, Record<string, number>>;
    expect(Object.keys(perFile).length).toBeGreaterThan(0);
    for (const readings of Object.values(perFile)) {
      if (typeof readings !== "object" || readings === null) continue; // provenance notes
      for (const rule of Object.values(defaultRules)) {
        const value = readings[rule.name];
        if (value === undefined) continue; // fixture predates the rule
        expect(typeof value).toBe("number");
        // Healthy code must never trip an ERROR; warns are legitimate nudges
        // (the self-lint corpus legitimately earns drift/consistency/
        // complexity warns on the files those claims describe).
        expect(rule.handle(value!)).not.toBe("error");
      }
    }
  });

  test(`damaged readings fire their rules at the right tier (consumer CI gate over a broken repo)`, async () => {
    const mutants = (await Bun.file(SENSITIVITY).json()) as Record<
      string,
      Record<string, number>
    > & { m3_comment_bloat_perfile: Record<string, Record<string, number>> };
    // m1_bad_names: naming collapses to errors
    expect(defaultRules.is_name_purposeful!.handle(mutants.m1_bad_names!.is_name_purposeful!)).toBe(
      "error",
    );
    expect(
      defaultRules.is_vocabulary_consistent!.handle(
        mutants.m1_bad_names!.is_vocabulary_consistent!,
      ),
    ).toBe("error");
    expect(
      defaultRules.is_naming_convention_consistent!.handle(
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
      defaultRules.is_comment_narration!.handle(s.is_comment_narration!),
    );
    expect(narrationSeverities.filter((s) => s === "error").length).toBe(5);
    expect(narrationSeverities.filter((s) => s === null).length).toBe(2);
    // and the family's other attributes do not mistake bloat for their own claim
    expect(
      defaultRules.is_comment_patching_readability!.handle(
        mutants.m3_comment_bloat!.is_comment_patching_readability!,
      ),
    ).toBeNull();
    expect(
      defaultRules.will_comment_drift!.handle(mutants.m3_comment_bloat!.will_comment_drift!),
    ).toBeNull();
    // m4_obfuscate: warns across the naming family + complexity. The
    // precision reading straddles the 0.5 error line across draws
    // (0.45-0.52); the naming error tier is pinned by m1 above.
    const m4 = [
      defaultRules.is_name_purposeful!.handle(mutants.m4_obfuscate!.is_name_purposeful!),
      defaultRules.is_vocabulary_consistent!.handle(
        mutants.m4_obfuscate!.is_vocabulary_consistent!,
      ),
      defaultRules.is_cognitively_complex!.handle(mutants.m4_obfuscate!.is_cognitively_complex!),
    ];
    expect(m4.every((s) => s === "warn")).toBe(true);
    // casing stays its own lane on obfuscation: single-letter renames mix
    // forms for one kind, warn tier
    expect(
      defaultRules.is_naming_convention_consistent!.handle(
        mutants.m4_obfuscate!.is_naming_convention_consistent!,
      ),
    ).toBe("warn");
    // m2_strip_comments (removing comments) fires no comment/name errors.
    // Its greppable reading (0.64) predates the scoped description; under the
    // new thresholds it lands in warn, so the tier assertion is non-error.
    for (const rule of Object.values(defaultRules)) {
      const severity = rule.handle(mutants.m2_strip_comments![rule.name]!);
      if (rule.name === "is_greppable") {
        expect(severity).not.toBe("error");
      } else {
        expect(severity).toBeNull();
      }
    }
  });
});

describe("rule definitions", () => {
  const ruleFires = (s: Rule): boolean => s.handle(0.05) !== null || s.handle(0.95) !== null;

  test("every rule has exactly one handle polarity; handles are the only thresholds", () => {
    // The handles are the only thresholds (the sweep anchors died with the two-stage funnel).
    // A firing handle must fire on exactly one side (high=good fires LOW, high=bad fires HIGH);
    // a measurement-only rule (null handle) fires on neither.
    for (const rule of Object.values(defaultRules)) {
      const firesLow = rule.handle(0.05) !== null;
      const firesHigh = rule.handle(0.95) !== null;
      expect(firesLow && firesHigh).toBe(false);
      expect(ruleFires(rule)).toBe(firesLow || firesHigh);
    }
  });

  test("default rules have calibrated criteria rules", () => {
    const names = Object.keys(defaultRules);
    expect(names).toEqual([
      "is_name_purposeful",
      "is_vocabulary_consistent",
      "is_naming_convention_consistent",
      "is_greppable",
      "is_comment_narration",
      "is_comment_patching_readability",
      "will_comment_drift",
      "will_error_lose_cause",
      "is_cognitively_complex",
      "is_function_srp",
      "is_readable",
    ]);
    for (const rule of Object.values(defaultRules)) {
      const criteria =
        rule.kind === "choice" ? rule.criteria : [rule.criteria.true, rule.criteria.false];
      expect(criteria.every((c) => c.length > 20)).toBe(true);
      expect(["files", "functions", "definitions", "comments", "imports", "diffs"]).toContain(
        rule.target,
      );
    }
  });

  test("handles return only error|warn|null", () => {
    const sampleValues = [0, 0.25, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.85, 0.9, 1];
    for (const rule of Object.values(defaultRules)) {
      for (const severity of severities(rule, sampleValues)) {
        expect(["error", "warn", null]).toContain(severity);
      }
    }
  });
});
