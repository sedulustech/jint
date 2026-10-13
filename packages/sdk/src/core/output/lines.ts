/**
 * The raw-line reporter — the CLI's default stdout. Findings only, one line per finding (the
 * canonical report's raw projection; measurements stay json-side). Stream discipline (clig): stdout
 * is pure finding data, stderr carries the run's own errors, degradation notes, and the totals
 * line. Line shape (LINE_SCHEMA):
 *
 * Path#id@L<line> rule level score
 *
 * Path#id is the finding input (the run-scoped key the app pairs with; it does NOT print). The raw
 * line is the LOC form only:
 *
 * Path@L<line> rule level score
 *
 * The chosen-level note stays json-side (it quotes the rule's own criterion, which the rubric block
 * already prints once); the run id is named once per run in the stderr requests notice.
 */

import { headCell, row, SEVERITY_WIDTH, tailCell, PATH_WIDTH, RULE_WIDTH } from "./format.ts";
import type { LintReport } from "../lint.ts";

export interface LinesRender {
  /** Findings, one raw line each. Empty when nothing was flagged. */
  readonly stdout: string;
  /** Run errors, degradation notes, totals. Empty when the run was clean and unrecorded. */
  readonly stderr: string;
}

export function renderLines(report: LintReport): LinesRender {
  const out: string[] = [];
  for (const f of report.findings) {
    // The element id is run-scoped (the report input stays path#id for the app to pair with); the
    // public line carries the LOC anchor only.
    const stem = f.input.split("#")[0]!;
    const anchor = f.location !== undefined ? `@L${f.location.span.start.line}` : "";
    out.push(
      row(
        tailCell(stem + anchor, PATH_WIDTH),
        headCell(f.rule, RULE_WIDTH),
        headCell(f.severity, SEVERITY_WIDTH),
        f.value.toFixed(2),
      ),
    );
  }

  const err: string[] = [];
  // Run errors — a ClassifyError is a unit the linter could not classify, not a lint finding.
  for (const e of report.errors) err.push(`error ${e.code} ${e.input}: ${e.message}`);
  // Degradation notes (oversized skips, scope exclusions): in-band, never silent.
  for (const note of report.notes) err.push(note);
  const errors = report.findings.filter((f) => f.severity === "error").length;
  // Zero findings on zero measurements is NOT a pass - qualify it so a scoped run that measured
  // nothing never reads as clean (the exit code already says 4; the line must agree).
  const nothingMeasured =
    report.measurements.length === 0 && report.errors.length === 0 ? " - nothing was measured" : "";
  err.push(
    `jint: ${report.findings.length} ${report.findings.length === 1 ? "problem" : "problems"} (${errors} ${errors === 1 ? "error" : "errors"}, ${report.findings.length - errors} ${report.findings.length - errors === 1 ? "warning" : "warnings"})${nothingMeasured}`,
  );

  return {
    stdout: out.length > 0 ? out.join("\n") + "\n" : "",
    stderr: err.length > 0 ? err.join("\n") + "\n" : "",
  };
}
