/**
 * The raw-line reporter — the CLI's default stdout. Findings only, one line per finding (the
 * canonical report's raw projection; measurements stay json-side). Stream discipline (clig): stdout
 * is pure finding data, stderr carries the run's own errors, degradation notes, and the totals
 * line. Line shape (LINE_SCHEMA):
 *
 * Path#id@L<line> rule level score [note] run=<id>
 *
 * Path#id is the finding input (the run-scoped key the app pairs with; it does NOT print). The raw
 * line is the LOC form only:
 *
 * Path@L<line> rule level score [note] run=<id>
 */

import type { LintReport } from "../lint.ts";

export interface LinesRender {
  /** Findings, one raw line each. Empty when nothing was flagged. */
  readonly stdout: string;
  /** Run errors, degradation notes, totals. Empty when the run was clean and unrecorded. */
  readonly stderr: string;
}

export function renderLines(report: LintReport, runId?: string): LinesRender {
  const out: string[] = [];
  for (const f of report.findings) {
    // The element id is run-scoped (the report input stays path#id for the app to pair with); the
    // public line carries the LOC anchor only.
    const stem = f.input.split("#")[0]!;
    const anchor = f.location !== undefined ? `@L${f.location.span.start.line}` : "";
    const note = f.note !== undefined ? `  [${f.note}]` : "";
    const run = runId !== undefined ? `  run=${runId}` : "";
    out.push(`${stem}${anchor}  ${f.rule}  ${f.severity}  ${f.value.toFixed(2)}${note}${run}`);
  }

  const err: string[] = [];
  // Run errors — a ClassifyError is a unit the linter could not classify, not a lint finding.
  for (const e of report.errors) err.push(`error ${e.code} ${e.input}: ${e.message}`);
  // Degradation notes (oversized skips, scope exclusions): in-band, never silent.
  for (const note of report.notes) err.push(note);
  const errors = report.findings.filter((f) => f.severity === "error").length;
  err.push(
    `jint: ${report.findings.length} problems (${errors} ${errors === 1 ? "error" : "errors"}, ${report.findings.length - errors} ${report.findings.length - errors === 1 ? "warning" : "warnings"})`,
  );

  return {
    stdout: out.length > 0 ? out.join("\n") + "\n" : "",
    stderr: err.length > 0 ? err.join("\n") + "\n" : "",
  };
}
