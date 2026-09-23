/**
 * Human reporter. Stream discipline (clig): stdout carries the findings — the signal table and the
 * findings summary; stderr carries the run's own errors and diagnostics — failed units
 * (RequestError lines), degradations, and their summary. Either stream stays usable when the other
 * is discarded.
 *
 * Severity wording stays "error"/"warn" on both streams (decided: no rename). TTY-adaptive color
 * per the clig contract: each stream is colored only when it itself is a TTY; NO_COLOR, TERM=dumb
 * and --color=never suppress it everywhere; --color=always forces it.
 *
 * V0 renders a simple aligned table (the documented stub).
 */

import type { LintReport } from "../lint.ts";

export type ColorMode = "auto" | "always" | "never";

/** The two rendered streams: findings for stdout, run errors/diagnostics for stderr. */
export interface StylishRender {
  /** Findings: signal table + findings summary. Empty when nothing was flagged. */
  readonly stdout: string;
  /**
   * Run errors and diagnostics: failed units, degradations, run summary. Empty when the run was
   * clean.
   */
  readonly stderr: string;
}

export function renderStylish(report: LintReport, mode: ColorMode = "auto"): StylishRender {
  const outColor = shouldColor(mode, process.stdout);
  const errColor = shouldColor(mode, process.stderr);
  const out: string[] = [];
  const err: string[] = [];

  // Run errors and diagnostics — stderr, never the findings report. Errors are failed requests to
  // the classifier (always error severity); degradations inform in yellow.
  for (const e of report.errors) {
    const line = `error ${e.code} ${e.input}: ${e.message}`;
    err.push(errColor ? red(line) : line);
  }
  for (const d of report.degradations) {
    const line = `warn ${d.code} ${d.input}: ${d.message}`;
    err.push(errColor ? yellow(line) : line);
  }
  const runSummary = runSummaryOf(report);
  if (runSummary !== null) {
    err.push("");
    err.push(errColor ? bold(runSummary) : runSummary);
  }

  // Findings — stdout.
  if (report.signals.length > 0) {
    const rows = report.signals.map((s) => ({
      severity: s.severity,
      value: s.value.toFixed(2),
      rule: s.rule,
      input: s.input,
    }));
    const wSev = Math.max(...rows.map((r) => r.severity.length), 5);
    const wVal = Math.max(...rows.map((r) => r.value.length), 5);
    const wRule = Math.max(...rows.map((r) => r.rule.length));
    for (const r of rows) {
      const sev = r.severity.padEnd(wSev);
      const val = r.value.padStart(wVal);
      const rule = r.rule.padEnd(wRule);
      const line = `${sev}  ${val}  ${rule}  ${r.input}`;
      out.push(outColor ? (r.severity === "error" ? red(line) : yellow(line)) : line);
    }
  }
  const findings = findingsSummaryOf(report);
  if (findings !== null) {
    out.push("");
    out.push(outColor ? bold(findings) : findings);
  }

  return {
    stdout: out.length > 0 ? out.join("\n") + "\n" : "",
    stderr: err.length > 0 ? err.join("\n") + "\n" : "",
  };
}

/** Findings summary (stdout): what the rules flagged, or the clean-run measurement count. */
function findingsSummaryOf(report: LintReport): string | null {
  if (report.signals.length > 0) {
    const errors = report.signals.filter((s) => s.severity === "error").length;
    const warnings = report.signals.length - errors;
    return (
      `${report.signals.length} ${report.signals.length === 1 ? "problem" : "problems"}` +
      ` (${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"})`
    );
  }
  // The clean-run line fires only when nothing else is reported anywhere (same cases as before the
  // stream split): a run with failed units or degradations never claims "clean".
  if (
    report.errors.length === 0 &&
    report.degradations.length === 0 &&
    report.measurements.length > 0
  ) {
    return `no signals — ${report.measurements.length} ${report.measurements.length === 1 ? "measurement" : "measurements"} clean`;
  }
  return null;
}

/** Run summary (stderr): what failed or degraded about the run itself. */
function runSummaryOf(report: LintReport): string | null {
  const parts: string[] = [];
  if (report.errors.length > 0) {
    parts.push(
      `${report.errors.length} ${report.errors.length === 1 ? "unit" : "units"} failed to measure`,
    );
  }
  if (report.degradations.length > 0) {
    parts.push(
      `${report.degradations.length} ${report.degradations.length === 1 ? "file" : "files"} not swept (no units derived)`,
    );
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

/** The TTY decision: explicit mode wins; otherwise the stream is a TTY minus NO_COLOR/TERM=dumb. */
export function shouldColor(
  mode: ColorMode,
  stream: { isTTY?: boolean } = process.stdout,
): boolean {
  if (mode === "always") return true;
  if (mode === "never") return false;
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === "dumb") return false;
  return stream.isTTY === true;
}

function red(text: string): string {
  return `\x1b[31m${text}\x1b[0m`;
}

function yellow(text: string): string {
  return `\x1b[33m${text}\x1b[0m`;
}

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[0m`;
}
