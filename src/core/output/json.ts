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
          ...(s.message !== undefined && { message: s.message }),
          ...(s.data !== undefined && { data: s.data }),
        })),
        errors: report.errors.map((e) => ({
          input: e.input,
          code: e.code,
          message: e.message,
        })),
        // In-band degradation (oversized skips, scope exclusions): same array the stylish
        // renderer prints on stderr — a machine consumer gets the identical signal, never less
        // (review 396888e finding 1: visibility that stops at the human renderer is not
        // visibility). Deterministic order is established by collectReport.
        notes: report.notes,
      },
      null,
      2,
    ) + "\n"
  );
}
