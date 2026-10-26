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
  rules: [],
};

describe("renderLines", () => {
  test("one line per finding; every line parses per LINE_SCHEMA", () => {
    const { stdout } = renderLines(report);
    const lines = stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(Value.Check(LINE_SCHEMA, line)).toBe(true);
    }
  });

  test("columns: fixed widths, aligned across every line (format.ts grammar)", () => {
    const { stdout } = renderLines(report);
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "                            src/a.ts  is_name_purposeful               warn   0.53",
    );
    expect(lines[1]).toBe(
      "                     src/b.ts@L8-L20  is_cognitively_complex           warn   2.00",
    );
    expect(lines[2]).toBe(
      "                            src/c.ts  is_function_srp                  error  1.00",
    );
    expect(stdout).not.toContain("#");
    expect(stdout).not.toContain("run=");
    expect(stdout).not.toContain("[");
  });

  test("a finding's message renders as an indented continuation line beneath it", () => {
    const { stdout } = renderLines({
      ...report,
      findings: [
        {
          rule: "is_comment_paired",
          input: "src/a.ts",
          value: 0.8,
          severity: "error",
          message: "keep the sentence, drop the file-name cross-reference",
        },
      ],
    });
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toContain("is_comment_paired");
    expect(lines[1]).toBe("    keep the sentence, drop the file-name cross-reference");
    // the continuation line never parses as a finding row (LINE_SCHEMA)
    expect(Value.Check(LINE_SCHEMA, lines[1]!)).toBe(false);
  });

  test("the chosen-level note never reaches the rendered line", () => {
    const { stdout } = renderLines(report);
    expect(stdout).not.toContain("[Moderate");
  });

  test("totals on stderr, never stdout; UNPREFIXED (the client's emitter owns jint:)", () => {
    const { stdout, stderr } = renderLines(report);
    expect(stdout).not.toContain("problems");
    expect(stderr).toContain("3 problems (1 error, 2 warnings)");
    expect(stderr).not.toContain("jint:");
  });

  test("run errors and degradation notes land on stderr, unprefixed; notes carry the note marker", () => {
    const { stderr } = renderLines({
      ...report,
      errors: [
        {
          name: "PROVIDER_TIMEOUT",
          input: "src/x.ts",
          code: "PROVIDER_TIMEOUT",
          message: "timed out",
        },
      ],
      notes: ["src/big.ts: 1 oversized element(s) skipped"],
    });
    expect(stderr).toContain("error PROVIDER_TIMEOUT src/x.ts: timed out");
    expect(stderr).toContain("note: src/big.ts: 1 oversized element(s) skipped");
    expect(stderr).not.toContain("jint:");
  });

  test("clean run: empty stdout, zero totals on stderr", () => {
    const { stdout, stderr } = renderLines({
      measurements: [],
      findings: [],
      errors: [],
      notes: [],
      rules: [],
    });
    expect(stdout).toBe("");
    expect(stderr).toContain("0 problems (0 errors, 0 warnings) - nothing was measured");
  });

  test("measured clean run: zero totals stay unqualified (a real pass reads as one)", () => {
    const { stderr } = renderLines({
      measurements: [{ input: "src/x.ts#d0", rule: "r", value: 0.1 }],
      findings: [],
      errors: [],
      rules: [],
      notes: [],
    });
    expect(stderr).toContain("0 problems (0 errors, 0 warnings)\n");
  });
});
