import type { Report, RunDetail } from "../types";

export interface RuleStat {
  rule: string;
  measurements: number;
  findings: number;
  errors: number;
  /** Findings / measurements, 0..1 */
  rate: number;
  /** 10-bin histogram of measurement values, 0..1 scale */
  histogram: number[];
}

export const BINS = 20;

/**
 * Per-rule verdict stats, from report measurements/findings when present, else from the run's
 * answers.
 */
export function ruleStats(report: Report | undefined, run: RunDetail | undefined): RuleStat[] {
  const map = new Map<string, RuleStat>();
  const stat = (rule: string): RuleStat => {
    let s = map.get(rule);
    if (!s) {
      s = {
        rule,
        measurements: 0,
        findings: 0,
        errors: 0,
        rate: 0,
        histogram: new Array(BINS).fill(0),
      };
      map.set(rule, s);
    }
    return s;
  };

  if (report) {
    for (const m of report.measurements) {
      const s = stat(m.rule);
      s.measurements += 1;
      s.histogram[Math.min(BINS - 1, Math.floor(m.value * BINS))] += 1;
    }
    for (const f of report.findings) stat(f.rule).findings += 1;
    for (const e of report.errors) stat("(" + e.code + ")").errors += 1;
  } else if (run) {
    // No report: fall back to answer counts per rule (measurements = answers seen, findings unknown).
    for (const r of run.requests) {
      for (const rule of r.rules) {
        const s = stat(rule);
        s.measurements += r.answers.length;
        for (const v of r.answers) s.histogram[Math.min(BINS - 1, Math.floor(v * BINS))] += 1;
      }
    }
  }

  const stats = [...map.values()].filter((s) => s.measurements > 0 || s.findings > 0);
  for (const s of stats) s.rate = s.measurements > 0 ? s.findings / s.measurements : 0;
  stats.sort((a, b) => b.findings - a.findings || a.rule.localeCompare(b.rule));
  return stats;
}
