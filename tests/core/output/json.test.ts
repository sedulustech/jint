import { describe, test, expect } from "bun:test";
import { renderJson, REPORT_FORMAT } from "../../../src/core/output/json.ts";
import type { LintReport } from "../../../src/core/lint.ts";
import { Value } from "@sinclair/typebox/value";
import { ReportSchema } from "../../../src/core/output/report-schema.ts";

const report: LintReport = {
  measurements: [
    { sensor: "is_name_purposeful", input: "src/a.ts", value: 0.5347219 },
    { sensor: "is_vocabulary_consistent", input: "src/a.ts", value: 0.9 },
  ],
  signals: [{ sensor: "is_name_purposeful", input: "src/a.ts", value: 0.5347219, severity: "warn" }],
  diagnostics: [{ input: "src/b.ts", code: "JEV_UNAVAILABLE", message: "jev unreachable" }],
};

describe("renderJson", () => {
  test("stable versioned shape", () => {
    const jsonStr = renderJson(report);
    const parsed = JSON.parse(jsonStr);
    expect(Value.Check(ReportSchema, parsed)).toBe(true);
    expect(parsed.tool).toBe("jint");
    expect(parsed.format).toBe(REPORT_FORMAT);
  });

  test("values pass through untouched (no rounding)", () => {
    const parsed = JSON.parse(renderJson(report));
    expect(parsed.measurements[0]!.value).toBe(0.5347219);
  });

  test("empty report renders with empty arrays", () => {
    const parsed = JSON.parse(renderJson({ measurements: [], signals: [], diagnostics: [] }));
    expect(parsed.measurements).toEqual([]);
    expect(parsed.signals).toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
  });

  test("output contains no ANSI escape codes", () => {
    expect(renderJson(report)).not.toContain("\x1b");
  });
});
