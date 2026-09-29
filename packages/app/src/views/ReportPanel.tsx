import { useQuery } from "@tanstack/react-query";
import { fetchReport, fetchRun } from "../api/client";
import { ruleStats } from "./ruleStats";
import type { Report } from "../types";

interface Props {
  runId: string;
  /** The rule the request table is currently filtered to; clicking the active rule clears it. */
  activeRule: string | null;
  onRuleSelect: (rule: string | null) => void;
}

export function ReportPanel({ runId, activeRule, onRuleSelect }: Props) {
  const report = useQuery({ queryKey: ["report", runId], queryFn: () => fetchReport(runId) });
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => fetchRun(runId) });

  const data = report.data;
  const degraded = run.data?.reportDegraded === true;
  const hasReport = !degraded && data !== undefined && !("absent" in data);
  const stats = ruleStats(hasReport ? (data as Report) : undefined, run.data);
  const errors = hasReport ? (data as Report).errors.length : 0;
  const notes = hasReport ? (data as Report).notes.length : 0;
  const totalFindings = stats.reduce((n, s) => n + s.findings, 0);
  const totalMeasurements = stats.reduce((n, s) => n + s.measurements, 0);
  const maxBin = Math.max(1, ...stats.flatMap((s) => s.histogram));

  return (
    <div
      id="report-panel-inner"
      className="shrink-0 overflow-y-auto border-b border-border bg-muted px-3 py-2 font-mono text-xs"
      style={{ maxHeight: "45vh" }}
    >
      {degraded && (
        <p className="text-amber-300">
          report.json is a partial fragment (torn write) — canonical rules and severities fell back
          to capture parsing; findings below may be incomplete. Regenerate the run to restore full
          verdicts.
        </p>
      )}
      {!report.isLoading && !hasReport && (
        <p className="text-muted-foreground">
          no report captured for this run — per-rule stats below come from capture answers only
          (findings unknown)
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-foreground">
          <span className="text-base font-bold">{totalFindings}</span> findings
        </span>
        <span className="text-muted-foreground">{totalMeasurements} measurements</span>
        <span className={errors > 0 ? "text-red-400" : "text-muted-foreground"}>
          {errors} errors
        </span>
        <span className="text-muted-foreground">{notes} notes</span>
        <span
          className="text-muted-foreground"
          title="healthy-max / defective-min gap: needs a probe corpus - a single run gives one distribution, not the gap"
        >
          calibration note
        </span>
      </div>
      <table className="mt-2 w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-4 font-normal">rule</th>
            <th className="py-1 pr-4 font-normal">measurements</th>
            <th className="py-1 pr-4 font-normal">findings</th>
            <th className="py-1 pr-4 font-normal">finding rate</th>
            <th className="py-1 font-normal">answer distribution (0 … 1, line at 0.5)</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr
              key={s.rule}
              onClick={() => onRuleSelect(activeRule === s.rule ? null : s.rule)}
              className={
                "cursor-pointer border-t border-border hover:bg-neutral-800/60 " +
                (activeRule === s.rule ? "bg-neutral-800" : "")
              }
              title="filter the request table to this rule"
            >
              <td className="py-1 pr-4">
                <span
                  className={activeRule === s.rule ? "font-bold text-white" : "text-foreground"}
                >
                  {s.rule}
                </span>
              </td>
              <td className="py-1 pr-4 text-muted-foreground">{s.measurements}</td>
              <td
                className={"py-1 pr-4 " + (s.findings > 0 ? "text-amber-300" : "text-emerald-400")}
              >
                {s.findings}
              </td>
              <td className="py-1 pr-4 text-foreground">{(s.rate * 100).toFixed(1)}%</td>
              <td className="py-1">
                <div className="pointer-events-none relative flex h-4 w-full min-w-64 items-end gap-px">
                  {s.histogram.map((n, i) => {
                    // neutral: shape, not verdict
                    const cls = "bg-neutral-500/70";
                    return (
                      <div
                        key={i}
                        className={`${cls} min-w-px flex-1`}
                        style={{ height: `${(n / maxBin) * 100}%`, minHeight: n > 0 ? 1 : 0 }}
                      />
                    );
                  })}
                  <div
                    className="absolute bottom-0 top-0 w-px bg-neutral-300"
                    style={{ left: "50%" }}
                  />
                </div>
              </td>
            </tr>
          ))}
          {stats.length === 0 && !report.isLoading && (
            <tr>
              <td colSpan={5} className="py-2 text-muted-foreground">
                no measurements found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
