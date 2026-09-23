import { describe, test, expect } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { MeasureError } from "../types.ts";
import { renderJson, REPORT_FORMAT } from "./json.ts";
import { REPORT_SCHEMA } from "./report-schema.ts";
import type { LintReport } from "../lint.ts";

const report: LintReport = {
  measurements: [
    { rule: "is_name_purposeful", input: "src/a.ts", value: 0.5347219 },
    { rule: "is_vocabulary_consistent", input: "src/a.ts", value: 0.9 },
  ],
  signals: [{ rule: "is_name_purposeful", input: "src/a.ts", value: 0.5347219, severity: "warn" }],
  errors: [new MeasureError("JEV_UNAVAILABLE", "src/b.ts", "jev unreachable")],
};

describe("renderJson", () => {
  test("stable versioned shape", () => {
    const jsonStr = renderJson(report);
    const parsed = JSON.parse(jsonStr);
    expect(Value.Check(REPORT_SCHEMA, parsed)).toBe(true);
    expect(parsed.tool).toBe("jint");
    expect(parsed.format).toBe(REPORT_FORMAT);
    expect(parsed.errors).toEqual([
      { input: "src/b.ts", code: "JEV_UNAVAILABLE", message: "jev unreachable" },
    ]);
  });

  test("values pass through untouched (no rounding)", () => {
    const parsed = JSON.parse(renderJson(report));
    expect(parsed.measurements[0]!.value).toBe(0.5347219);
  });

  test("empty report renders with empty arrays", () => {
    const parsed = JSON.parse(renderJson({ measurements: [], signals: [], errors: [] }));
    expect(parsed.measurements).toEqual([]);
    expect(parsed.signals).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  test("output contains no ANSI escape codes", () => {
    expect(renderJson(report)).not.toContain("\x1b");
  });
});
