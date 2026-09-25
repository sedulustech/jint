import { describe, test, expect } from "bun:test";
import { MeasureError } from "../types.ts";
import { renderStylish, shouldColor } from "./stylish.ts";
import type { LintReport } from "../lint.ts";

const report: LintReport = {
  notes: [],
  measurements: [{ rule: "is_name_purposeful", input: "src/a.ts", value: 0.5347 }],
  findings: [
    { rule: "is_name_purposeful", input: "src/a.ts", value: 0.5347, severity: "warn" },
    {
      rule: "is_greppable",
      input: "src/tui/deeply/nested/path.ts",
      value: 0.3,
      severity: "error",
    },
  ],
  errors: [new MeasureError("JEV_UNAVAILABLE", "src/b.ts", "jev unreachable")],
};

describe("renderStylish", () => {
  test("stream discipline: findings stdout, run errors/diagnostics stderr (clig)", () => {
    // columns: severity(5) 2sp value(5) 2sp rule(21) 2sp input
    const { stdout, stderr } = renderStylish(report, "never");
    // stdout: findings only — the findings table and the findings summary
    expect(stdout).toContain("warn    0.53  is_name_purposeful  src/a.ts");
    expect(stdout).toContain("error   0.30  is_greppable        src/tui/deeply/nested/path.ts");
    expect(stdout).toContain("2 problems (1 error, 1 warning)");
    expect(stdout).not.toContain("JEV_UNAVAILABLE");
    expect(stdout).not.toContain("failed to measure");
    expect(stdout).not.toContain("measurements:"); // measurements are not the human payload
    // stderr: run errors and diagnostics only
    expect(stderr).toContain("error JEV_UNAVAILABLE src/b.ts: jev unreachable");
    expect(stderr).toContain("1 unit failed to measure");
    expect(stderr).not.toContain("is_name_purposeful");
    expect(stderr).not.toContain("problems");
  });

  test("stdout stays usable when stderr is discarded, and vice versa", () => {
    const { stdout, stderr } = renderStylish(report, "never");
    // each stream is self-contained: discard one, the other still tells its whole story
    expect(stdout).toContain("2 problems (1 error, 1 warning)");
    expect(stderr).toContain("JEV_UNAVAILABLE");
    // a findings-only report renders nothing on stderr; an error-only report nothing on stdout
    const clean = renderStylish(
      {
        measurements: [{ rule: "s", input: "i", value: 0.5 }],
        findings: [],
        errors: [],
        notes: [],
      },
      "never",
    );
    expect(clean.stderr).toBe("");
    const failedOnly = renderStylish(
      { measurements: [], findings: [], errors: report.errors, notes: [] },
      "never",
    );
    expect(failedOnly.stdout).toBe("");
    expect(failedOnly.stderr).toContain("1 unit failed to measure");
  });

  test("summary line for a clean run mentions the measurement count", () => {
    const { stdout } = renderStylish(
      {
        measurements: [{ rule: "s", input: "i", value: 0.5 }],
        findings: [],
        errors: [],
        notes: [],
      },
      "never",
    );
    expect(stdout).toContain("no findings — 1 measurement clean");
  });

  test("a run with failed units never claims clean on stdout", () => {
    const { stdout, stderr } = renderStylish(
      {
        measurements: [{ rule: "s", input: "i", value: 0.5 }],
        findings: [],
        errors: report.errors,
        notes: [],
      },
      "never",
    );
    expect(stdout).toBe("");
    expect(stderr).toContain("1 unit failed to measure");
  });

  test("completely empty report renders empty on both streams", () => {
    const { stdout, stderr } = renderStylish(
      { measurements: [], findings: [], errors: [], notes: [] },
      "never",
    );
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  test("color modes: never strips, always forces — on both streams", () => {
    const plain = renderStylish(report, "never");
    expect(plain.stdout).not.toContain("\x1b");
    expect(plain.stderr).not.toContain("\x1b");
    const forced = renderStylish(report, "always");
    expect(forced.stdout).toContain("\x1b[31m"); // red finding rows (error severity)
    expect(forced.stdout).toContain("\x1b[33m"); // yellow finding rows (warn severity)
    expect(forced.stderr).toContain("\x1b[31m"); // red MeasureError lines
  });
});

describe("shouldColor", () => {
  test("NO_COLOR and TERM=dumb suppress auto color", () => {
    const atty = { isTTY: true };
    const savedNoColor = process.env.NO_COLOR;
    const savedTerm = process.env.TERM;
    try {
      process.env.NO_COLOR = "1";
      process.env.TERM = "xterm-256color";
      expect(shouldColor("auto", atty)).toBe(false);
      process.env.NO_COLOR = undefined;
      process.env.TERM = "dumb";
      expect(shouldColor("auto", atty)).toBe(false);
      process.env.TERM = "xterm-256color";
      expect(shouldColor("auto", atty)).toBe(true);
      expect(shouldColor("never", atty)).toBe(false);
      expect(shouldColor("always", { isTTY: false })).toBe(true);
    } finally {
      if (savedNoColor !== undefined) process.env.NO_COLOR = savedNoColor;
      else delete process.env.NO_COLOR;
      if (savedTerm !== undefined) process.env.TERM = savedTerm;
      else delete process.env.TERM;
    }
  });
});
