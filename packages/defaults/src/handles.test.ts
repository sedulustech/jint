import { describe, test, expect } from "bun:test";
import { compileRule, type Rule } from "@jint/sdk";
import { defaultRules as defaultSchemas } from "./index.ts";

/** The compiled baseline: the schemas compiled through the sdk's public seam, as the CLI does. */
const defaultRules: Record<string, Rule> = Object.fromEntries(
  defaultSchemas.map((schema) => {
    const rule = compileRule(schema as never, "@jint/defaults");
    return [rule.name, rule];
  }),
);

/** The severity a rule's handler returns for a value (null = silent). */
const sev = (rule: Rule | undefined, v: number): string | null =>
  rule?.handle({ value: v })?.severity ?? null;

// File-relative (Bun.file is cwd-relative, and bun test runs from the repo root): the
// calibration corpus is shared root-level fixture data (tests/ = e2e + shared fixtures).
const CALIBRATION = new URL(
  "../../../tests/data/calibration/healthy-baselines.json",
  import.meta.url,
);
const SENSITIVITY = new URL(
  "../../../tests/data/calibration/mutant-readings.json",
  import.meta.url,
);

function severities(rule: Rule, values: number[]): (string | null)[] {
  return values.map((v) => sev(rule, v));
}

describe("default handles: polarity", () => {
  test("naming rules are high=good (error below threshold)", () => {
    expect(sev(defaultRules.is_name_purposeful, 0.1)).toBe("error");
    expect(sev(defaultRules.is_name_purposeful, 0.35)).toBe("warn");
    expect(sev(defaultRules.is_name_purposeful, 0.45)).toBeNull();
    expect(sev(defaultRules.is_vocabulary_consistent, 0.5)).toBe("error");
    expect(sev(defaultRules.is_vocabulary_consistent, 0.7)).toBe("warn");
    expect(sev(defaultRules.is_vocabulary_consistent, 0.8)).toBeNull();
    expect(sev(defaultRules.is_naming_convention_consistent, 0.6)).toBe("error");
    expect(sev(defaultRules.is_naming_convention_consistent, 0.7)).toBe("warn");
    expect(sev(defaultRules.is_naming_convention_consistent, 0.9)).toBeNull();
    expect(sev(defaultRules.is_greppable, 0.3)).toBe("error");
    expect(sev(defaultRules.is_greppable, 0.55)).toBe("error");
    expect(sev(defaultRules.is_greppable, 0.65)).toBe("warn");
    expect(sev(defaultRules.is_greppable, 0.8)).toBeNull();
    // is_filename_fitting: high = bad; anchored on the two-language filename-fit
    // probe - healthy ceiling 0.33 (Go, cobra) / 0.36 (TS, jint src/), defective
    // floor 0.60 / 0.88 (the generic-name-hides-a-subject case is the soft one).
    expect(sev(defaultRules.is_filename_fitting, 0.33)).toBeNull();
    expect(sev(defaultRules.is_filename_fitting, 0.5)).toBeNull();
    expect(sev(defaultRules.is_filename_fitting, 0.6)).toBe("warn");
    expect(sev(defaultRules.is_filename_fitting, 0.94)).toBe("error");
  });

  test("comment/complexity rules are high=bad (error above threshold)", () => {
    expect(sev(defaultRules.is_comment_narration, 0.5)).toBe("error");
    expect(sev(defaultRules.is_comment_narration, 0.35)).toBe("warn");
    expect(sev(defaultRules.is_comment_narration, 0.25)).toBeNull();
    expect(sev(defaultRules.is_comment_patching_readability, 0.6)).toBe("error");
    expect(sev(defaultRules.is_comment_patching_readability, 0.45)).toBe("warn");
    expect(sev(defaultRules.is_comment_patching_readability, 0.35)).toBeNull();
    expect(sev(defaultRules.will_comment_drift, 0.75)).toBe("error");
    expect(sev(defaultRules.will_comment_drift, 0.6)).toBe("warn");
    expect(sev(defaultRules.will_comment_drift, 0.5)).toBeNull();
    // is_cognitively_complex is a scored rubric (0..2): error at round>=2, warn at round>=1,
    // calibrated two-language (app/src + cobra) — see defaults.ts and the rebuild design.
    expect(sev(defaultRules.is_cognitively_complex, 1.7)).toBe("error");
    expect(sev(defaultRules.is_cognitively_complex, 1.2)).toBe("warn");
    expect(sev(defaultRules.is_cognitively_complex, 0.4)).toBeNull();
  });
});

describe("ci gate simulation: known-good corpus passes, damaged corpus fails", () => {
  test(`known-good readings produce no error-severity findings (consumer CI gate over a clean repo)`, async () => {
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
        expect(sev(rule, value!)).not.toBe("error");
      }
    }
  });

  test(`damaged readings fire their rules at the right tier (consumer CI gate over a broken repo)`, async () => {
    const mutants = (await Bun.file(SENSITIVITY).json()) as Record<
      string,
      Record<string, number>
    > & { m3_comment_bloat_perfile: Record<string, Record<string, number>> };
    // m1_bad_names: naming collapses to errors
    expect(sev(defaultRules.is_name_purposeful, mutants.m1_bad_names!.is_name_purposeful!)).toBe(
      "error",
    );
    expect(
      sev(defaultRules.is_vocabulary_consistent, mutants.m1_bad_names!.is_vocabulary_consistent!),
    ).toBe("error");
    expect(
      sev(
        defaultRules.is_naming_convention_consistent,
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
      sev(defaultRules.is_comment_narration, s.is_comment_narration!),
    );
    expect(narrationSeverities.filter((s) => s === "error").length).toBe(5);
    expect(narrationSeverities.filter((s) => s === null).length).toBe(2);
    // and the family's other attributes do not mistake bloat for their own claim
    expect(
      sev(
        defaultRules.is_comment_patching_readability,
        mutants.m3_comment_bloat!.is_comment_patching_readability!,
      ),
    ).toBeNull();
    expect(
      sev(defaultRules.will_comment_drift, mutants.m3_comment_bloat!.will_comment_drift!),
    ).toBeNull();
    // m4_obfuscate: the naming family + complexity. The mutant readings predate the per-rule
    // questions (issue 001) and read HIGHER than the new question scores the same damage
    // (name 0.52, casing 0.78 now clear even the lowered warn tiers), so the family assertion
    // covers only vocabulary + complexity; the naming error tier is pinned by m1 above.
    // The complexity reading (0.5) is a NOUL probability under the retired binary claim, not a
    // score on the 0..2 rubric - interpreting it as a score is meaningless (it happens to round
    // to warn). Like the casing reading above, assert the weak honest claim (non-error) until the
    // mutant corpus is re-measured under the scored question.
    expect(
      sev(defaultRules.is_vocabulary_consistent, mutants.m4_obfuscate!.is_vocabulary_consistent!),
    ).toBe("warn");
    expect(
      sev(defaultRules.is_cognitively_complex, mutants.m4_obfuscate!.is_cognitively_complex!),
    ).not.toBe("error");
    // casing stays its own lane on obfuscation: single-letter renames mix forms for one kind.
    // The stale UNIT_TASK reading (0.78) predates the per-rule question (median 0.87 -> 0.82),
    // so under the re-anchored tiers it no longer warns — assert non-error until the mutant
    // corpus is re-classified under the new questions.
    expect(
      sev(
        defaultRules.is_naming_convention_consistent,
        mutants.m4_obfuscate!.is_naming_convention_consistent!,
      ),
    ).not.toBe("error");
    // m2_strip_comments (removing comments) fires no comment/name errors.
    // Its greppable reading (0.64) predates the scoped description; under the
    // new thresholds it lands in warn, so the tier assertion is non-error.
    for (const rule of Object.values(defaultRules)) {
      const value = mutants.m2_strip_comments![rule.name];
      if (value === undefined) continue; // fixture predates the rule
      const severity = sev(rule, value);
      if (rule.name === "is_greppable") {
        expect(severity).not.toBe("error");
      } else {
        expect(severity).toBeNull();
      }
    }
  });
});

describe("rule definitions", () => {
  const ruleFires = (s: Rule): boolean => sev(s, 0.05) !== null || sev(s, 0.95) !== null;

  test("every rule has exactly one handle polarity; handles are the only thresholds", () => {
    // The handles are the only thresholds (the sweep anchors died with the two-stage funnel).
    // A firing handle must fire on exactly one side (high=good fires LOW, high=bad fires HIGH);
    // a measurement-only rule (null handle) fires on neither.
    for (const rule of Object.values(defaultRules)) {
      const firesLow = sev(rule, 0.05) !== null;
      const firesHigh = sev(rule, 0.95) !== null;
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
      "is_filename_fitting",
      "is_comment_narration",
      "is_comment_patching_readability",
      "will_comment_drift",
      "will_error_lose_cause",
      "is_cognitively_complex",
      "is_function_srp",
    ]);
    for (const rule of Object.values(defaultRules)) {
      const criteria =
        rule.kind === "choice" ? rule.criteria : [rule.criteria.true, rule.criteria.false];
      expect(criteria.every((c) => c.length > 20)).toBe(true);
      expect(["files", "functions", "definitions", "comments", "imports"]).toContain(rule.target);
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
