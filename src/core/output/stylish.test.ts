import { describe, test, expect } from "bun:test";
import { renderStylish, shouldColor } from "./stylish.ts";
import type { LintReport } from "../lint.ts";

const report: LintReport = {
  measurements: [{ sensor: "is_name_purposeful", input: "src/a.ts", value: 0.5347 }],
  signals: [
    { sensor: "is_name_purposeful", input: "src/a.ts", value: 0.5347, severity: "warn" },
    {
      sensor: "is_greppable",
      input: "src/tui/deeply/nested/path.ts",
      value: 0.3,
      severity: "error",
    },
  ],
  diagnostics: [{ input: "src/b.ts", code: "JEV_UNAVAILABLE", message: "jev unreachable" }],
};

describe("renderStylish", () => {
  test("signals only, aligned columns, diagnostics surfaced", () => {
    // columns: severity(5) 2sp value(5) 2sp sensor(21) 2sp input
    const out = renderStylish(report, "never");
    expect(out).toContain("error JEV_UNAVAILABLE src/b.ts: jev unreachable");
    expect(out).toContain("warn    0.53  is_name_purposeful  src/a.ts");
    expect(out).toContain("error   0.30  is_greppable        src/tui/deeply/nested/path.ts");
    expect(out).toContain("2 problems (1 error, 1 warning)");
    expect(out).not.toContain("measurements:"); // measurements are not the human payload
  });

  test("summary line for a clean run mentions the measurement count", () => {
    const out = renderStylish(
      { measurements: [{ sensor: "s", input: "i", value: 0.5 }], signals: [], diagnostics: [] },
      "never",
    );
    expect(out).toContain("no signals — 1 measurement clean");
  });

  test("completely empty report renders empty", () => {
    expect(renderStylish({ measurements: [], signals: [], diagnostics: [] }, "never")).toBe("");
  });

  test("color modes: never strips, always forces", () => {
    expect(renderStylish(report, "never")).not.toContain("\x1b");
    expect(renderStylish(report, "always")).toContain("\x1b[31m"); // red error rows
    expect(renderStylish(report, "always")).toContain("\x1b[33m"); // yellow warn rows
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
