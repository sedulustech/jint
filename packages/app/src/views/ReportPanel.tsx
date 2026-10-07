import { useQuery } from "@tanstack/react-query";
import { fetchReport, fetchRun } from "../api/client";
import { ROW_CURSOR, ROW_HOVER } from "../lib/row";
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
  const maxHistogramBin = Math.max(1, ...reportRuleStats.flatMap((statRow) => statRow.histogram));

  return (
    <div
      id="report-panel-inner"
      className="shrink-0 overflow-y-auto border-b border-border bg-background px-rail py-inner text-body"
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
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-body whitespace-nowrap">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-rail py-cell-y font-normal">rule</th>
              <th className="px-rail py-cell-y font-normal">measurements</th>
              <th className="px-rail py-cell-y font-normal">findings</th>
              <th className="px-rail py-cell-y font-normal">finding rate</th>
              <th className="px-rail py-cell-y font-normal">
                answer distribution (0 … 1, line at 0.5)
              </th>
            </tr>
          </thead>
          <tbody>
            {reportRuleStats.map((statRow) => (
              <tr
                key={statRow.rule}
                data-testid={`report-rule-${statRow.rule}`}
                onClick={() => onRuleFocus(statRow.rule)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRuleFocus(statRow.rule);
                  }
                }}
                className={`${ROW_CURSOR} border-t border-border ${ROW_HOVER}`}
                title="show this rule's group in the table"
              >
                <td className="px-rail py-cell-y">
                  <span className="text-foreground">{statRow.rule}</span>
                </td>
                <td className="px-rail py-cell-y text-muted-foreground">{statRow.measurements}</td>
                <td
                  className={
                    "px-rail py-cell-y " +
                    (statRow.findings > 0 ? "text-sev-warn" : "text-sev-clean")
                  }
                >
                  {statRow.findings}
                </td>
                <td className="px-rail py-cell-y text-foreground">
                  {(statRow.rate * 100).toFixed(1)}%
                </td>
                <td className="px-rail py-cell-y">
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
                <td colSpan={5} className="px-rail py-inner text-muted-foreground">
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
