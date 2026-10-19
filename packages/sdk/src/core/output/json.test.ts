import { describe, test, expect } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { ClassifyError } from "../types.ts";
import { renderJson } from "./json.ts";
import { REPORT_SCHEMA } from "./report-schema.ts";
import type { LintReport } from "../lint.ts";

const report: LintReport = {
  notes: [],
  rules: [],
  measurements: [
    { rule: "is_name_purposeful", input: "src/a.ts", value: 0.5347219 },
    { rule: "is_vocabulary_consistent", input: "src/a.ts", value: 0.9 },
  ],
  findings: [
    {
      rule: "is_name_purposeful",
      input: "src/a.ts",
      value: 0.5347219,
      severity: "warn",
      confidence: 0,
      probabilities: { "0": 0.5, "1": 0, "2": 0.5 },
    },
    {
      rule: "is_cognitively_complex",
      input: "src/b.ts#uuid",
      value: 2,
      severity: "warn",
      note: "Moderate: the reader must pause once or twice",
      location: {
        input: "src/b.ts#uuid",
        span: {
          start: { line: 8, column: 1 },
          end: { line: 20, column: 2 },
          startByte: 100,
          endByte: 400,
        },
      },
    },
  ],
  errors: [new ClassifyError("JEV_UNAVAILABLE", "src/b.ts", "jev unreachable")],
};

describe("renderJson", () => {
  test("stable shape", () => {
    const jsonStr = renderJson(report);
    const parsed = JSON.parse(jsonStr);
    expect(Value.Check(REPORT_SCHEMA, parsed)).toBe(true);
    expect(parsed.tool).toBe("jint");
    expect(parsed.errors).toEqual([
      { input: "src/b.ts", code: "JEV_UNAVAILABLE", message: "jev unreachable" },
    ]);
  });

  // v1.3 self-containment: note (legend text) and location serialize; a renderer never reaches
  // into criteria or recorded requests for display data.
  test("score findings carry note + location; the report is self-contained", () => {
    const parsed = JSON.parse(renderJson(report));
    expect(parsed.findings[0]).not.toHaveProperty("note");
    expect(parsed.findings[1]!.note).toBe("Moderate: the reader must pause once or twice");
    expect(parsed.findings[1]!.location.span.start.line).toBe(8);
  });

  test("values pass through untouched (no rounding)", () => {
    const parsed = JSON.parse(renderJson(report));
    expect(parsed.measurements[0]!.value).toBe(0.5347219);
  });

  test("empty report renders with empty arrays", () => {
    const parsed = JSON.parse(
      renderJson({ measurements: [], findings: [], errors: [], notes: [], rules: [] }),
    );
    expect(parsed.measurements).toEqual([]);
    expect(parsed.findings).toEqual([]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.notes).toEqual([]);
  });

  // Review 396888e finding 1: notes (scope exclusions, oversized skips) are in-band SIGNAL —
  // the machine shape carries them too, after errors, or --json runs report scoping as silence.
  test("notes serialize after errors", () => {
    const noted: LintReport = {
      ...report,
      notes: [
        "tests/a.ts: scope excluded - rule 'is_name_purposeful' scope excluded 2 element(s)",
        "element src/big.ts#L1-L900 exceeds 100000 chars - skipped",
      ],
    };
    const parsed = JSON.parse(renderJson(noted));
    expect(parsed.notes).toEqual(noted.notes);
    const keys = Object.keys(parsed);
    expect(keys.indexOf("notes")).toBeGreaterThan(keys.indexOf("errors"));
  });

  // The finding's certainty rides the wire: copied from the measurement when present, omitted
  // (key absent, not null) when the answer had none - an agent reads findings alone.
  test("findings carry confidence + probabilities when the answer had them; keys omit otherwise", () => {
    const parsed = JSON.parse(renderJson(report));
    expect(parsed.findings[0]!.confidence).toBe(0);
    expect(parsed.findings[0]!.probabilities).toEqual({ "0": 0.5, "1": 0, "2": 0.5 });
    expect(parsed.findings[1]).not.toHaveProperty("confidence");
    expect(parsed.findings[1]).not.toHaveProperty("probabilities");
  });

  test("output contains no ANSI escape codes", () => {
    expect(renderJson(report)).not.toContain("\x1b");
  });

  // The run pointer: top-level run {id, dir}, present only on reports from recorded runs.
  test("run pointer serializes when set; capture-less reports omit it", () => {
    const withRun = { ...report, run: { id: "1791916340873", dir: "/tmp/x/runs/1791916340873" } };
    const parsed = JSON.parse(renderJson(withRun));
    expect(parsed.run).toEqual({ id: "1791916340873", dir: "/tmp/x/runs/1791916340873" });
    expect(Value.Check(REPORT_SCHEMA, parsed)).toBe(true);
    expect(JSON.parse(renderJson(report))).not.toHaveProperty("run");
  });
});
