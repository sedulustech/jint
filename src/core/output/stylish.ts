/**
 * Human reporter: signals only (measurements are the raw "what is true"; signals are what
 * mattered), plus run diagnostics. TTY-adaptive color per the clig contract: color only when stdout
 * is a TTY; NO_COLOR, TERM=dumb and --color=never all suppress it; --color=always forces it.
 *
 * V0 renders a simple aligned table (the documented stub).
 */

import type { LintReport } from "../lint.ts";

export type ColorMode = "auto" | "always" | "never";

export function renderStylish(report: LintReport, mode: ColorMode = "auto"): string {
  const colorize = shouldColor(mode);
  const out: string[] = [];

  for (const d of report.diagnostics) {
    const severity = d.severity ?? "error";
    const line = `${severity} ${d.code} ${d.input}: ${d.message}`;
    out.push(colorize ? (severity === "warn" ? yellow(line) : red(line)) : line);
  }

  if (report.signals.length > 0) {
    const rows = report.signals.map((s) => ({
      severity: s.severity,
      value: s.value.toFixed(2),
      sensor: s.sensor,
      input: s.input,
    }));
    const wSev = Math.max(...rows.map((r) => r.severity.length), 5);
    const wVal = Math.max(...rows.map((r) => r.value.length), 5);
    const wSensor = Math.max(...rows.map((r) => r.sensor.length));
    for (const r of rows) {
      const sev = r.severity.padEnd(wSev);
      const val = r.value.padStart(wVal);
      const sensor = r.sensor.padEnd(wSensor);
      const line = `${sev}  ${val}  ${sensor}  ${r.input}`;
      out.push(colorize ? (r.severity === "error" ? red(line) : yellow(line)) : line);
    }
  }

  const summary = stylishSummary(report);
  if (summary !== null) {
    out.push("");
    out.push(colorize ? bold(summary) : summary);
  }
  return out.length > 0 ? out.join("\n") + "\n" : "";
}

function stylishSummary(report: LintReport): string | null {
  const parts: string[] = [];
  const errors = report.signals.filter((s) => s.severity === "error").length;
  const warnings = report.signals.length - errors;
  if (report.signals.length > 0) {
    parts.push(
      `${report.signals.length} ${report.signals.length === 1 ? "problem" : "problems"}` +
        ` (${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"})`,
    );
  }
  const failures = report.diagnostics.filter((d) => (d.severity ?? "error") === "error");
  const degraded = report.diagnostics.filter((d) => d.severity === "warn");
  if (failures.length > 0) {
    parts.push(`${failures.length} ${failures.length === 1 ? "unit" : "units"} failed to measure`);
  }
  if (degraded.length > 0) {
    parts.push(
      `${degraded.length} ${degraded.length === 1 ? "file" : "files"} measured whole (decomposition degraded)`,
    );
  }
  if (parts.length === 0 && report.measurements.length > 0) {
    parts.push(
      `no signals — ${report.measurements.length} ${report.measurements.length === 1 ? "measurement" : "measurements"} clean`,
    );
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

/** The TTY decision: explicit mode wins; otherwise stdout-is-TTY minus NO_COLOR/TERM=dumb. */
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
