import { describe, test, expect } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { renderLines } from "./lines.ts";
import { LINE_SCHEMA } from "./report-schema.ts";
import type { LintReport } from "../lint.ts";

const report: LintReport = {
  measurements: [],
  findings: [
    { rule: "is_name_purposeful", input: "src/a.ts", value: 0.5347219, severity: "warn" },
    {
      rule: "is_cognitively_complex",
      input: "src/b.ts#uuid-1",
      value: 2,
      severity: "warn",
      note: "Moderate: the reader must pause once or twice",
      location: {
        input: "src/b.ts#uuid-1",
        span: {
          start: { line: 8, column: 1 },
          end: { line: 20, column: 2 },
          startByte: 100,
          endByte: 400,
        },
      },
    },
    { rule: "is_function_srp", input: "src/c.ts#uuid-2", value: 1, severity: "error" },
  ],
  errors: [],
  notes: [],
};

describe("renderLines", () => {
  test("one line per finding; every line parses per LINE_SCHEMA", () => {
    const { stdout } = renderLines(report, "1790865385203");
    const lines = stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(Value.Check(LINE_SCHEMA, line)).toBe(true);
    }
  });

  test("columns: path@L<line>  rule  level  score  [note]  run=<id> (id never prints)", () => {
    const { stdout } = renderLines(report, "1790865385203");
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("src/a.ts  is_name_purposeful  warn  0.53  run=1790865385203");
    expect(lines[1]).toBe(
      "src/b.ts@L8  is_cognitively_complex  warn  2.00  [Moderate: the reader must pause once or twice]  run=1790865385203",
    );
    expect(lines[2]).toBe("src/c.ts  is_function_srp  error  1.00  run=1790865385203");
    expect(stdout).not.toContain("#");
  });

  test("run column omitted when recording is inactive (no runId)", () => {
    const { stdout } = renderLines(report);
    expect(stdout).not.toContain("run=");
    for (const line of stdout.trimEnd().split("\n")) {
      expect(Value.Check(LINE_SCHEMA, line)).toBe(true);
    }
  });

  test("totals on stderr, never stdout; stdout stays pure finding data", () => {
    const { stdout, stderr } = renderLines(report);
    expect(stdout).not.toContain("problems");
    expect(stderr).toContain("jint: 3 problems (1 error, 2 warnings)");
  });

  test("run errors and degradation notes land on stderr", () => {
    const { stderr } = renderLines({
      ...report,
      errors: [
        { name: "JEV_TIMEOUT", input: "src/x.ts", code: "JEV_TIMEOUT", message: "timed out" },
      ],
      notes: ["src/big.ts: 1 oversized element(s) skipped"],
    });
    expect(stderr).toContain("error JEV_TIMEOUT src/x.ts: timed out");
    expect(stderr).toContain("src/big.ts: 1 oversized element(s) skipped");
  });

  test("clean run: empty stdout, zero totals on stderr", () => {
    const { stdout, stderr } = renderLines({
      measurements: [],
      findings: [],
      errors: [],
      notes: [],
    });
    expect(stdout).toBe("");
    expect(stderr).toContain("jint: 0 problems (0 errors, 0 warnings) - nothing was measured");
  });

  test("measured clean run: zero totals stay unqualified (a real pass reads as one)", () => {
    const { stderr } = renderLines({
      measurements: [{ input: "src/x.ts#d0", rule: "r", value: 0.1 }],
      findings: [],
      errors: [],
      notes: [],
    });
    expect(stderr).toContain("jint: 0 problems (0 errors, 0 warnings)\n");
  });
});
