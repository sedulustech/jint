/**
 * JSON reporter — the machine shape. Stability promise: this shape is versioned (format field);
 * never break it in a patch release. stdout carries nothing but this when --json is set. Stream
 * discipline (clig): the document is data — errors ride in it; human-facing operational messages
 * are a stylish-mode concern (stderr) and are never embedded here.
 */

import pkg from "../../../package.json";
import type { LintReport } from "../lint.ts";

export const REPORT_FORMAT = "jint-report/v1";

export function renderJson(report: LintReport): string {
  return (
    JSON.stringify(
      {
        tool: "jint",
        format: REPORT_FORMAT,
        version: pkg.version,
        measurements: report.measurements.map((m) => ({
          rule: m.rule,
          input: m.input,
          value: m.value,
          ...(m.stage !== undefined && { stage: m.stage }),
        })),
        findings: report.findings.map((s) => ({
          rule: s.rule,
          input: s.input,
          value: s.value,
          severity: s.severity,
          // Additive (jint-report/v1): element-scoped findings carry the element's exact span.
          ...(s.location !== undefined && {
            location: { input: s.location.input, span: s.location.span },
          }),
        })),
        errors: report.errors.map((e) => ({
          input: e.input,
          code: e.code,
          message: e.message,
        })),
      },
      null,
      2,
    ) + "\n"
  );
}
