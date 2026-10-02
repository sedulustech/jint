import { useQuery } from "@tanstack/react-query";
import { fetchReport, fetchRun } from "../api/client";
import { ruleStats } from "./ruleStats";
import type { Report } from "../types";

interface Props {
  runId: string;
  /** Clicking a rule surfaces that rule's group: the table switches to rule mode, expands + scrolls. */
  onRuleFocus: (rule: string) => void;
}

export function ReportPanel({ runId, onRuleFocus }: Props) {
  const reportQuery = useQuery({ queryKey: ["report", runId], queryFn: () => fetchReport(runId) });
  const runQuery = useQuery({ queryKey: ["run", runId], queryFn: () => fetchRun(runId) });

  const runPayload = runQuery.data;
  const reportPayload = reportQuery.data;
  const isDegradedReport = runPayload?.reportDegraded === true;
  const isLegacyRun = runPayload?.legacy === true;
  const hasReport =
    !isDegradedReport && reportPayload !== undefined && !("absent" in reportPayload);
  const reportRuleStats = ruleStats(hasReport ? (reportPayload as Report) : undefined, runPayload);
  const totalErrors = hasReport ? (reportPayload as Report).errors.length : 0;
  const totalNotes = hasReport ? (reportPayload as Report).notes.length : 0;
  const totalFindings = reportRuleStats.reduce((sum, statRow) => sum + statRow.findings, 0);
  const totalMeasurements = reportRuleStats.reduce((sum, statRow) => sum + statRow.measurements, 0);
  const maxHistogramBin = Math.max(1, ...reportRuleStats.flatMap((statRow) => statRow.histogram));

  return (
    <div
      id="report-panel-inner"
      className="shrink-0 overflow-y-auto border-b border-border bg-muted px-3 py-2 font-mono text-body"
      style={{ maxHeight: "45vh" }}
    >
      {isDegradedReport && (
        <p className="text-sev-warn">
          report.json is a partial fragment (torn write) — canonical rules and severities fell back
          to request parsing; findings below may be incomplete. Regenerate the run to restore full
          verdicts.
        </p>
      )}
      {!reportQuery.isLoading && !hasReport && (
        <p className="text-muted-foreground">
          {isLegacyRun
            ? "no report — run recorded before reports existed (migrated pre-store run); findings unknown"
            : "no report — run captured without --json; per-rule stats below come from per-request answers only (findings unknown)"}
        </p>
      )}
      {/* stat strip (F3): all four numbers on the SAME emphasis step - only the count changes */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-foreground">
          <span className="text-emphasis font-bold">{totalFindings}</span> findings
        </span>
        <span className="text-muted-foreground">
          <span className="text-emphasis">{totalMeasurements}</span> measurements
        </span>
        <span className={totalErrors > 0 ? "text-sev-error" : "text-muted-foreground"}>
          <span className="text-emphasis">{totalErrors}</span> errors
        </span>
        <span className="text-muted-foreground">
          <span className="text-emphasis">{totalNotes}</span> notes
        </span>
        <span
          className="text-muted-foreground"
          title="healthy-max / defective-min gap: needs a probe corpus - a single run gives one distribution, not the gap"
        >
          calibration note
        </span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-body whitespace-nowrap">
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
            {reportRuleStats.map((statRow) => (
              <tr
                key={statRow.rule}
                onClick={() => onRuleFocus(statRow.rule)}
                className="cursor-pointer border-t border-border hover:bg-muted"
                title="show this rule's group in the table"
              >
                <td className="py-1 pr-4">
                  <span className="text-foreground">{statRow.rule}</span>
                </td>
                <td className="py-1 pr-4 text-muted-foreground">{statRow.measurements}</td>
                <td
                  className={
                    "py-1 pr-4 " + (statRow.findings > 0 ? "text-sev-warn" : "text-sev-clean")
                  }
                >
                  {statRow.findings}
                </td>
                <td className="py-1 pr-4 text-foreground">{(statRow.rate * 100).toFixed(1)}%</td>
                <td className="py-1">
                  <div className="pointer-events-none relative flex h-4 w-full min-w-64 items-end gap-px">
                    {statRow.histogram.map((binCount, binIndex) => {
                      // neutral: shape, not verdict
                      const barClassName = "bg-[var(--chart-bar)]";
                      return (
                        <div
                          key={binIndex}
                          className={`${barClassName} min-w-px flex-1`}
                          style={{
                            height: `${(binCount / maxHistogramBin) * 100}%`,
                            minHeight: binCount > 0 ? 1 : 0,
                          }}
                        />
                      );
                    })}
                    <div
                      className="absolute bottom-0 top-0 w-px bg-[var(--chart-ref)]"
                      style={{ left: "50%" }}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {reportRuleStats.length === 0 && !reportQuery.isLoading && (
              <tr>
                <td colSpan={5} className="py-2 text-muted-foreground">
                  report present but zero measurements
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
