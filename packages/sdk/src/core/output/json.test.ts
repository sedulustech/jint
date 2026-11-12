import { describe, test, expect } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { ClassifyError } from "../types.ts";
import { renderJson } from "./json.ts";
import { REPORT_SCHEMA } from "./report-schema.ts";
import type { LintReport } from "../lint.ts";

const report: LintReport = {
  notes: [],
  rules: [],
  classifications: [
    { rule: "is_name_purposeful", input: "src/a.ts", value: 0.5347219 },
    { rule: "is_naming_convention_consistent", input: "src/a.ts", value: 0.9 },
  ],
  findings: [
    {
      rule: "is_name_purposeful",
      input: "src/a.ts",
      value: 0.5347219,
      severity: "warn",
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
  errors: [
    new ClassifyError("PROVIDER_UNAVAILABLE", "src/b.ts", "provider unreachable"),
    new ClassifyError("PROVIDER_RESPONSE_INVALID", "src/c.ts#L4", "no answer", { rule: "r" }),
  ],
};

describe("renderJson", () => {
  test("stable shape", () => {
    const jsonStr = renderJson(report);
    const parsed = JSON.parse(jsonStr);
    expect(Value.Check(REPORT_SCHEMA, parsed)).toBe(true);
    expect(parsed.tool).toBe("jint");
    expect(parsed.errors).toEqual([
      { input: "src/b.ts", code: "PROVIDER_UNAVAILABLE", message: "provider unreachable" },
      { input: "src/c.ts#L4", code: "PROVIDER_RESPONSE_INVALID", message: "no answer", rule: "r" },
    ]);
  });

  test("score findings carry note + location; the report is self-contained", () => {
    const parsed = JSON.parse(renderJson(report));
    expect(parsed.findings[0]).not.toHaveProperty("note");
    expect(parsed.findings[1]!.note).toBe("Moderate: the reader must pause once or twice");
    expect(parsed.findings[1]!.location.span.start.line).toBe(8);
  });

  test("values pass through untouched (no rounding)", () => {
    const parsed = JSON.parse(renderJson(report));
    expect(parsed.classifications[0]!.value).toBe(0.5347219);
  });

  test("a refused classification serializes without a value and validates", () => {
    const refused: LintReport = {
      ...report,
      classifications: [{ rule: "is_function_srp", input: "src/a.ts#u", refused: true }],
      findings: [],
    };
    const parsed = JSON.parse(renderJson(refused));
    expect(parsed.classifications).toEqual([
      { rule: "is_function_srp", input: "src/a.ts#u", refused: true },
    ]);
    expect(Value.Check(REPORT_SCHEMA, parsed)).toBe(true);
  });

  test("empty report renders with empty arrays", () => {
    const parsed = JSON.parse(
      renderJson({ classifications: [], findings: [], errors: [], notes: [], rules: [] }),
    );
    expect(parsed.classifications).toEqual([]);
    expect(parsed.findings).toEqual([]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.notes).toEqual([]);
  });

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

  test("findings carry probabilities when the answer had them; the key omits otherwise", () => {
    const parsed = JSON.parse(renderJson(report));
    expect(parsed.findings[0]!.probabilities).toEqual({ "0": 0.5, "1": 0, "2": 0.5 });
    expect(parsed.findings[1]).not.toHaveProperty("probabilities");
  });

  test("classifications and findings carry the provider's confidence; the key omits otherwise", () => {
    const withConfidence: LintReport = {
      ...report,
      classifications: [
        { rule: "r", input: "src/a.ts", value: 1.2, probabilities: { "1": 1 }, confidence: 0.36 },
        { rule: "q", input: "src/a.ts", value: 0.5 },
        { rule: "z", input: "src/a.ts", refused: true },
      ],
      findings: [
        { rule: "r", input: "src/a.ts", value: 1.2, severity: "warn", confidence: 0.36 },
        { rule: "q", input: "src/a.ts", value: 0.5, severity: "warn" },
      ],
    };
    const parsed = JSON.parse(renderJson(withConfidence));
    expect(Value.Check(REPORT_SCHEMA, parsed)).toBe(true);
    expect(parsed.classifications[0].confidence).toBe(0.36);
    expect(parsed.classifications[1]).not.toHaveProperty("confidence");
    expect(parsed.classifications[2]).not.toHaveProperty("confidence");
    expect(parsed.findings[0].confidence).toBe(0.36);
    expect(parsed.findings[1]).not.toHaveProperty("confidence");
  });

  test("output contains no ANSI escape codes", () => {
    expect(renderJson(report)).not.toContain("\x1b");
  });

  test("run pointer serializes when set; capture-less reports omit it", () => {
    const withRun = { ...report, run: { id: "1791916340873", dir: "/tmp/x/runs/1791916340873" } };
    const parsed = JSON.parse(renderJson(withRun));
    expect(parsed.run).toEqual({ id: "1791916340873", dir: "/tmp/x/runs/1791916340873" });
    expect(Value.Check(REPORT_SCHEMA, parsed)).toBe(true);
    expect(JSON.parse(renderJson(report))).not.toHaveProperty("run");
  });
});
