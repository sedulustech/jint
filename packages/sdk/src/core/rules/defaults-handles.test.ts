import { describe, test, expect } from "bun:test";
import { defaultRules as defaultSchemas } from "@jint/defaults";
import { compileRule } from "../../config/load.ts";
import type { Rule } from "../types.ts";

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
  "../../../../../tests/data/calibration/healthy-baselines.json",
  import.meta.url,
);
const SENSITIVITY = new URL(
  "../../../../../tests/data/calibration/mutant-readings.json",
  import.meta.url,
);

// TODO(schema-tests): the calibration fixtures' is_name_purposeful readings predate the score
// form - they were taken under the retired count-based criteria, so they are 0..1 probabilities
// read here as 0..2 level indexes, which is meaningless (healthy 0.8-0.88 happens to round to a
// warn tier; the m1 defective 0.08 happens to round to silence). Until the corpus is
// re-classified under the scored question AND re-probed on a second language (issue 001's
// two-language bar - the same bar that gated is_filename_fitting's promotion), the gates below
// can only assert the weak honest claim (non-error) for that rule. Do not re-tier these
// assertions against probability readings, and do not attempt re-measurement here (live API).

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
    // m1_bad_names: naming collapses to errors. is_name_purposeful's fixture reading predates
    // the score form (see the TODO above) - the weak honest claim until re-measurement.
    expect(
      sev(defaultRules.is_vocabulary_consistent, mutants.m1_bad_names!.is_vocabulary_consistent!),
    ).toBe("error");
    expect(
      sev(
        defaultRules.is_naming_convention_consistent,
        mutants.m1_bad_names!.is_naming_convention_consistent!,
      ),
    ).toBe("error");
    expect(
      sev(defaultRules.is_name_purposeful, mutants.m1_bad_names!.is_name_purposeful!),
    ).not.toBe("error");
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
      } else if (rule.name === "is_name_purposeful") {
        // the fixture's reading is from the noul form (a probability, not a level index);
        // under the score form it resolves to level 1 - assert non-error until the mutant
        // corpus is re-classified under the score question
        expect(severity).not.toBe("error");
      } else {
        expect(severity).toBeNull();
      }
    }
  });
});

// Two regression classes the corpus gates above cannot see, pinned here directly against the
// handle data. These rows are NOT mirrors of the kind deleted below: a mirror fails exactly when
// the data moves and proves nothing, while these hold a claim no other test holds.
// - Score-map ORDER is schema-invisible: validation checks the map's length (== criteria count)
//   and that at least one level is non-pass, never the direction of the tiers - and no fixture
//   reading reaches level 2, so re-tiering the top level ([pass,warn,error] -> [pass,warn,pass])
//   passes every gate silently. The scored rules' boundaries are pinned at their rubric edges.
// - is_filename_fitting has NO corpus readings (absent from both calibration fixtures), so the
//   gates never touch its tiers; its issue-006 two-language gap (TS healthy max 0.36 / Go 0.33
//   against defective floors 0.60 / 0.88) exists only as these rows.
// - is_greppable's healthy band (0.81-0.82) sits just above its warn_at: an upward threshold
//   drift would push the band into warn, which the not-error gates cannot see.
describe("handles the corpus gates cannot see", () => {
  test("score-map order: the top level stays error, not re-tiered to pass", () => {
    expect(sev(defaultRules.is_name_purposeful, 2)).toBe("error");
    expect(sev(defaultRules.is_name_purposeful, 1)).toBe("warn");
    expect(sev(defaultRules.is_name_purposeful, 0)).toBeNull();
    expect(sev(defaultRules.is_cognitively_complex, 1.7)).toBe("error");
    expect(sev(defaultRules.is_cognitively_complex, 1.2)).toBe("warn");
    expect(sev(defaultRules.is_cognitively_complex, 0.4)).toBeNull();
  });

  test("is_filename_fitting: the issue-006 two-language gap, recorded as rows", () => {
    expect(sev(defaultRules.is_filename_fitting, 0.36)).toBeNull(); // TS healthy max (issue 006 gap)
    expect(sev(defaultRules.is_filename_fitting, 0.6)).toBe("warn"); // Go defective floor
    expect(sev(defaultRules.is_filename_fitting, 0.94)).toBe("error"); // defective tail
  });

  test("is_greppable: the healthy band's top stays silent", () => {
    expect(sev(defaultRules.is_greppable, 0.8)).toBeNull();
  });
});

describe("default handles: polarity", () => {
  test("every rule fires on exactly one side; handles are the only thresholds", () => {
    // The handles are the only thresholds (the sweep anchors died with the two-stage funnel).
    // A firing handle must fire on exactly one side (high=good fires LOW, high=bad fires HIGH);
    // the per-value tiers themselves live in the handle data and its calibration comments -
    // restating them here would only mirror the data, not test anything.
    for (const rule of Object.values(defaultRules)) {
      const firesLow = sev(rule, 0.05) !== null;
      const firesHigh = sev(rule, 0.95) !== null;
      expect(firesLow && firesHigh).toBe(false);
    }
  });

  test("handles return only error|warn|null", () => {
    const sampleValues = [0, 0.25, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.85, 0.9, 1];
    for (const rule of Object.values(defaultRules)) {
      for (const severity of sampleValues.map((v) => sev(rule, v))) {
        expect(["error", "warn", null]).toContain(severity);
      }
    }
  });
});
