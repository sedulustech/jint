/**
 * JSON reporter — the machine shape. Stability promise: this shape is versioned (format field);
 * never break it in a patch release. stdout carries nothing but this when --json is set. Stream
 * discipline (clig): the document is data — errors/degradations ride in it; human-facing
 * operational messages are a stylish-mode concern (stderr) and are never embedded here.
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
          sensor: m.sensor,
          input: m.input,
          value: m.value,
          ...(m.stage !== undefined && { stage: m.stage }),
        })),
        signals: report.signals.map((s) => ({
          sensor: s.sensor,
          input: s.input,
          value: s.value,
          severity: s.severity,
          // Additive (jint-report/v1): confirmed funnel signals carry the leaf's exact span.
          ...(s.location !== undefined && {
            location: { input: s.location.input, span: s.location.span },
          }),
        })),
        errors: report.errors.map((e) => ({
          input: e.input,
          code: e.code,
          message: e.message,
        })),
        degradations: report.degradations.map((d) => ({
          input: d.input,
          code: d.code,
          message: d.message,
        })),
      },
      null,
      2,
    ) + "\n"
  );
}
