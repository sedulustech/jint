import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fetchReport, fetchRun } from "../api/client";
import { ruleStats } from "./ruleStats";
import type { Report } from "../types";
import { Button } from "@/components/ui/button";

interface Props {
  runId: string;
  /** Whether the report panel below is expanded (URL-owned state) */
  reportOpen: boolean;
  onToggleReport: () => void;
}

/**
 * Always-visible strip above the report: the stat row (F3) + the show/hide toggle. It renders even
 * when the report is hidden so the toggle can re-show it; the table itself stays in ReportPanel.
 */
export function ReportHeader({ runId, reportOpen, onToggleReport }: Props) {
  const reportQuery = useQuery({ queryKey: ["report", runId], queryFn: () => fetchReport(runId) });
  const runQuery = useQuery({ queryKey: ["run", runId], queryFn: () => fetchRun(runId) });

  const runPayload = runQuery.data;
  const reportPayload = reportQuery.data;
  const isDegradedReport = runPayload?.reportDegraded === true;
  const hasReport =
    !isDegradedReport && reportPayload !== undefined && !("absent" in reportPayload);
  const reportRuleStats = ruleStats(hasReport ? (reportPayload as Report) : undefined, runPayload);
  const totalErrors = hasReport ? (reportPayload as Report).errors.length : 0;
  const totalNotes = hasReport ? (reportPayload as Report).notes.length : 0;
  const totalFindings = reportRuleStats.reduce((sum, statRow) => sum + statRow.findings, 0);
  const totalMeasurements = reportRuleStats.reduce((sum, statRow) => sum + statRow.measurements, 0);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-meta border-b border-border bg-muted px-rail py-bar-y text-body">
      <Button
        variant="secondary"
        size="icon-xs"
        data-testid="report-toggle"
        disabled={reportQuery.isLoading || !hasReport}
        aria-expanded={reportOpen}
        aria-controls="report-panel"
        aria-disabled={reportQuery.isLoading || !hasReport}
        aria-label={
          reportQuery.isLoading
            ? "report loading"
            : hasReport
              ? reportOpen
                ? "hide report"
                : "show report"
              : "no report"
        }
        title={
          reportQuery.isLoading
            ? "report…"
            : hasReport
              ? reportOpen
                ? "hide report"
                : "show report"
              : "no report"
        }
        onClick={onToggleReport}
        className="disabled:cursor-not-allowed"
      >
        {reportOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </Button>
      {/* stat strip (F3): all four numbers on the SAME emphasis step - only the count changes */}
      <div className="flex flex-wrap items-center gap-x-meta gap-y-related">
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
    </div>
  );
}
