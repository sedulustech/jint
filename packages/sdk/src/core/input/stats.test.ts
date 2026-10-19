import { describe, test, expect } from "bun:test";
import { inputStats, renderInputSummary, SKIP_REASONS, type InputSummary } from "./stats.ts";

describe("input stats accumulator", () => {
  test("marks and tallies compose the summary; zero-count entries never appear", () => {
    const stats = inputStats();
    stats.markDiscovered();
    stats.markDiscovered();
    stats.markIncluded();
    stats.tallyExclude("**/*.test.ts");
    stats.tallyExclude("**/*.test.ts");
    stats.tallySkip(SKIP_REASONS.binary);
    expect(stats.summary()).toEqual({
      discovered: 2,
      included: 1,
      excluded: [{ glob: "**/*.test.ts", count: 2 }],
      skipped: [{ reason: "BINARY", count: 1 }],
      admitted: [],
    });
  });

  test("a glob that never dropped a file is absent (the summary carries facts, not the config)", () => {
    const stats = inputStats();
    stats.markDiscovered();
    stats.markIncluded();
    expect(stats.summary().excluded).toEqual([]);
  });
});

describe("renderInputSummary (the human mirror)", () => {
  const summary = (over: Partial<InputSummary>): InputSummary => ({
    discovered: 0,
    included: 0,
    excluded: [],
    skipped: [],
    admitted: [],
    ...over,
  });

  test("nothing dropped: no line (run and capture stay quiet on a clean walk)", () => {
    expect(
      renderInputSummary(summary({ discovered: 3, included: 3 }), [
        { by: "config", patterns: ["**/*.ts"] },
      ]),
    ).toEqual([]);
  });

  test("the ruling's line shape: counts at one level, skipped reasons named", () => {
    expect(
      renderInputSummary(
        summary({
          discovered: 120,
          included: 34,
          excluded: [{ glob: "**/*.test.ts", count: 22 }],
          skipped: [{ reason: "MISSING_GRAMMAR", count: 3 }],
        }),
        [],
      ),
    ).toEqual(["input: 34 of 120 files (22 excluded by config, skipped: MISSING_GRAMMAR 3)"]);
  });

  test("skipped-only drops drop the excluded clause", () => {
    expect(
      renderInputSummary(
        summary({ discovered: 5, included: 4, skipped: [{ reason: "BINARY", count: 1 }] }),
        [],
      ),
    ).toEqual(["input: 4 of 5 files (skipped: BINARY 1)"]);
  });

  test("the silent-empty case: include dropped EVERYTHING - line two names the scope", () => {
    const lines = renderInputSummary(
      summary({
        discovered: 2,
        included: 0,
        skipped: [{ reason: "NOT_IN_INCLUDE", count: 2 }],
      }),
      [{ by: "config", patterns: ["**/*.rs"] }],
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("input: 0 of 2 files (skipped: NOT_IN_INCLUDE 2)");
    expect(lines[1]).toContain("outside every scope [**/*.rs]");
  });

  test("empty by exclude globs names the generic scope, not the scope", () => {
    const lines = renderInputSummary(
      summary({ discovered: 2, included: 0, excluded: [{ glob: "**/*", count: 2 }] }),
      [{ by: "config", patterns: ["**/*.rs"] }],
    );
    expect(lines[1]).toBe(
      "input: nothing was measured - every discovered file was excluded or skipped",
    );
  });
});
