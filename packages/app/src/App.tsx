import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { useEffect, useState } from "react";
import { fetchReport, fetchRuns } from "./api/client";
import { ReportPanel } from "./views/ReportPanel";
import { RequestDetail } from "./views/RequestDetail";
import { RequestTable } from "./views/RequestTable";
import type { Report, RequestSummary } from "./types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const baseName = (p: string) => p.split("/").pop() ?? p;
const relTime = (mtime: string) =>
  `${formatDistanceToNowStrict(new Date(mtime), { addSuffix: true })}`;

export function App() {
  const [runId, setRunId] = useState<string | null>(null);
  const [selected, setSelected] = useState<RequestSummary | null>(null);
  // null = follow the run's default (open when a report.json exists); toggle sets an override.
  const [reportOverride, setReportOverride] = useState<boolean | null>(null);
  // rule filter shared by the report table (setter) and the request table (consumer)
  const [ruleFilter, setRuleFilter] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ["runs"], queryFn: fetchRuns });
  const reportQ = useQuery({
    queryKey: ["report", runId],
    queryFn: () => fetchReport(runId ?? ""),
    enabled: runId !== null,
  });
  const reportData =
    reportQ.data && !("absent" in reportQ.data) ? (reportQ.data as Report) : undefined;
  // Only runs with an actual report.json can open the panel; the override never overrides absence.
  const reportOpen = reportData !== undefined && (reportOverride ?? true);
  // Shape guard: the endpoint must answer { runs, hiddenLegacy }. A contract slip degrades to an
  // empty list + hint, never a white screen.
  const payload =
    runs.data && Array.isArray(runs.data.runs) ? runs.data : { runs: [], hiddenLegacy: 0 };
  const list = payload.runs;
  const selectedRun = list.find((r) => r.id === runId) ?? null;

  // a new run resets the user's overrides so the default-open rule applies fresh
  useEffect(() => {
    setReportOverride(null);
    setRuleFilter(null);
  }, [runId]);

  const pick = (id: string) => {
    setRunId(id === "" ? null : id);
    setSelected(null);
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-3 py-1.5">
        <h1 className="font-mono text-xs font-bold text-neutral-300">jint</h1>
        <Select value={runId ?? "none"} onValueChange={pick}>
          <SelectTrigger className="w-96 font-mono text-xs" aria-label="run">
            <SelectValue
              placeholder={runs.isLoading ? "loading runs…" : `select a run (${list.length})`}
            />
          </SelectTrigger>
          <SelectContent>
            {list.map((r) => (
              <SelectItem
                key={r.id}
                value={r.id}
                className="font-mono text-xs"
                title={r.configPath}
              >
                <span className="text-neutral-200">{baseName(r.configPath)}</span>
                <span className="text-neutral-500">
                  {" "}
                  · {relTime(r.mtime)} · {r.requests} req
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {runId !== null && (
          <Button
            variant={reportOpen ? "secondary" : "outline"}
            size="sm"
            disabled={reportQ.isLoading || !reportData}
            aria-expanded={reportOpen}
            aria-controls="report-panel"
            aria-disabled={reportQ.isLoading || !reportData}
            onClick={() => setReportOverride(!reportOpen)}
            className="font-mono text-xs"
          >
            {reportQ.isLoading
              ? "report…"
              : reportData
                ? `report · ${reportData.findings.length} findings · ${reportData.measurements.length} measurements ${reportOpen ? "▾" : "▸"}`
                : "no report"}
          </Button>
        )}
        {list.length > 0 && runId === null && (
          <Badge variant="outline" className="font-mono">
            {list.length} runs
          </Badge>
        )}
        {payload.hiddenLegacy > 0 && (
          <span
            className="font-mono text-xs text-neutral-500"
            title="runs without manifest.json cannot be shown - regenerate the dump or delete them"
          >
            {payload.hiddenLegacy} legacy run{payload.hiddenLegacy === 1 ? "" : "s"} hidden
          </span>
        )}
        {runs.error instanceof Error && (
          <span
            className="max-w-[480px] truncate break-words font-mono text-xs text-red-400"
            title={runs.error.message}
          >
            {runs.error.message}
          </span>
        )}
        {selectedRun !== null && (
          <span className="ml-auto font-mono text-xs text-neutral-400" data-testid="header-time">
            {new Date(selectedRun.mtime).toLocaleString()}
          </span>
        )}
      </header>
      {runId === null ? (
        <div className="m-auto flex max-w-xl flex-col items-center gap-3 font-mono text-sm text-neutral-400">
          {list.length === 0 ? (
            <p>no runs found - set JINT_REQUESTS_DIR or run jint once</p>
          ) : (
            <>
              <p>select a run</p>
              <div className="flex flex-wrap justify-center gap-2">
                {list.slice(0, 8).map((run) => (
                  <Button
                    key={run.id}
                    variant="outline"
                    size="sm"
                    className="font-mono text-xs"
                    onClick={() => pick(run.id)}
                  >
                    {baseName(run.configPath)} · {run.requests} req
                  </Button>
                ))}
              </div>
              {list.length > 8 && (
                <p className="text-xs text-neutral-500">…{list.length - 8} more in the picker</p>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {reportOpen && (
            <div id="report-panel">
              <ReportPanel runId={runId} activeRule={ruleFilter} onRuleSelect={setRuleFilter} />
            </div>
          )}
          <div className="flex min-h-0 flex-1">
            <RequestTable
              runId={runId}
              ruleFilter={ruleFilter}
              onClearRule={() => setRuleFilter(null)}
              onSelect={setSelected}
              selectedFile={selected?.file ?? null}
            />
            {selected !== null && (
              <RequestDetail runId={runId} summary={selected} onClose={() => setSelected(null)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
