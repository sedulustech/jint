import { describe, test, expect } from "bun:test";
import { allRules as ruleSchemas } from "@jint/rules";
import { compileRule } from "../../config/load.ts";
import type { Rule } from "../types.ts";

/** The compiled catalog: the schemas compiled through the sdk's public seam, as the CLI does. */
const catalog: Record<string, Rule> = Object.fromEntries(
  ruleSchemas.map((schema) => {
    const rule = compileRule(schema as never, "@jint/rules");
    return [rule.name, rule];
  }),
);

/** The severity a rule's handler returns for a value (null = silent). */
const sev = (rule: Rule | undefined, v: number): string | null =>
  rule?.handle({ value: v })?.severity ?? null;

// Pinned directly against the handle data - rows that hold a claim no mirror holds.
// - Score-map ORDER is schema-invisible: validation checks the map's length (== criteria count)
//   and that at least one level is non-pass, never the direction of the tiers - and no fixture
//   reading reaches level 2, so re-tiering the top level ([pass,warn,error] -> [pass,warn,pass])
//   passes every gate silently. The scored rules' boundaries are pinned at their rubric edges.
// - has_filename_mismatch has NO recorded corpus readings, so nothing else touches its tiers; its issue-006 two-language gap (TS healthy max 0.36 / Go 0.33
//   against defective floors 0.60 / 0.88) exists only as these rows.
// - is_greppable's healthy band (0.81-0.82) sits just above its warn_at: an upward threshold
//   drift would push the band into warn, which a polarity-only test cannot see.
describe("handles the corpus gates cannot see", () => {
  test("score-map order: the top level stays error, not re-tiered to pass", () => {
    expect(sev(catalog.is_cognitively_complex, 1.7)).toBe("error");
    expect(sev(catalog.is_cognitively_complex, 1.2)).toBe("warn");
    expect(sev(catalog.is_cognitively_complex, 0.4)).toBeNull();
  });

  test("has_filename_mismatch: the issue-006 two-language gap, recorded as rows", () => {
    expect(sev(catalog.has_filename_mismatch, 0.36)).toBeNull(); // TS healthy max (issue 006 gap)
    expect(sev(catalog.has_filename_mismatch, 0.6)).toBe("warn"); // Go defective floor
    expect(sev(catalog.has_filename_mismatch, 0.94)).toBe("error"); // defective tail
  });

  test("is_greppable: the healthy band's top stays silent", () => {
    expect(sev(catalog.is_greppable, 0.8)).toBeNull();
  });
});

describe("default handles: polarity", () => {
  test("every rule fires on exactly one side; handles are the only thresholds", () => {
    // The handles are the only thresholds (the sweep anchors died with the two-stage funnel).
    // A firing handle must fire on exactly one side (high=good fires LOW, high=bad fires HIGH);
    // the per-value tiers themselves live in the handle data and its calibration comments -
    // restating them here would only mirror the data, not test anything.
    for (const rule of Object.values(catalog)) {
      const firesLow = sev(rule, 0.05) !== null;
      const firesHigh = sev(rule, 0.95) !== null;
      expect(firesLow && firesHigh).toBe(false);
    }
  });

  test("handles return only error|warn|null", () => {
    const sampleValues = [0, 0.25, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.85, 0.9, 1];
    for (const rule of Object.values(catalog)) {
      for (const severity of sampleValues.map((v) => sev(rule, v))) {
        expect(["error", "warn", null]).toContain(severity);
      }
    }
  });
});
