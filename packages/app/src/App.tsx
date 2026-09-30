import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { useEffect, useState } from "react";
import { fetchReport, fetchRuns } from "./api/client";
import { PairDetail } from "./views/PairDetail";
import { ReportPanel } from "./views/ReportPanel";
import { RequestTable } from "./views/RequestTable";
import { useTheme } from "./views/useTheme";
import type { Report } from "./types";
import type { Mode } from "./views/useRun";
import type { Theme } from "./views/useTheme";
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

// deep link: #runs/<id> opens that run directly (tolerate trailing slash / whitespace)
const runIdFromHash = (): string | null => {
  if (typeof window === "undefined" || !window.location) return null;
  const m = window.location.hash.match(/^\s*#runs\/([^/\s]+)\/?\s*$/);
  return m ? m[1] : null;
};
const syncHash = (id: string) => {
  if (typeof window === "undefined" || !window.location) return;
  // empty clears the link without a history entry; a real id pushes one so back works
  if (id === "") window.history?.pushState(null, "", "#");
  else window.location.hash = `#runs/${id}`;
};
const relTime = (mtime: string) =>
  `${formatDistanceToNowStrict(new Date(mtime), { addSuffix: true })}`;

export function App() {
  const { theme, choose } = useTheme();
  const [runId, setRunId] = useState<string | null>(runIdFromHash);
  // the detail pane is addressed by a rule-target pair, never by request identity
  const [selectedPair, setSelectedPair] = useState<{
    rule: string;
    input: string;
    requestFile?: string;
  } | null>(null);
  const [mode, setMode] = useState<Mode>("request");
  // one-shot: a report-panel click expands + scrolls to the rule's group in rule mode
  const [focusRule, setFocusRule] = useState<string | null>(null);
  // null = follow the run's default (open when a report.json exists); toggle sets an override.
  const [reportOverride, setReportOverride] = useState<boolean | null>(null);
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
    runs.data && Array.isArray(runs.data.runs)
      ? runs.data
      : { runs: [], hiddenLegacy: 0, legacyRuns: [] as string[] };
  const list = payload.runs;
  const selectedRun = list.find((r) => r.id === runId) ?? null;

  // a new run resets the user's overrides so the default-open rule applies fresh
  useEffect(() => {
    setReportOverride(null);
    setMode("request");
    setSelectedPair(null);
  }, [runId]);

  const pick = (id: string) => {
    setRunId(id === "" ? null : id);
    setSelectedPair(null);
    syncHash(id);
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-muted px-3 py-1.5">
        <h1 className="font-mono text-emphasis font-bold text-foreground">jint</h1>
        <Select value={runId ?? "none"} onValueChange={pick}>
          <SelectTrigger className="w-96 font-mono text-body" aria-label="run">
            <SelectValue
              placeholder={runs.isLoading ? "loading runs…" : `select a run (${list.length})`}
            />
          </SelectTrigger>
          <SelectContent>
            {/* virtualizing 400+ options is overkill for a picker; cap at the newest 50 and say
                so - the quick-pick empty state covers the most recent runs anyway */}
            {list.slice(0, 50).map((r) => (
              <SelectItem
                key={r.id}
                value={r.id}
                className="font-mono text-body"
                title={`${r.configPath}\nrun id: ${r.id}`}
              >
                <span className="text-foreground">{baseName(r.configPath)}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {relTime(r.mtime)} · {r.requests} req · {r.id.slice(-6)}
                </span>
              </SelectItem>
            ))}
            {list.length > 50 && (
              <div className="px-2 py-1 font-mono text-caption text-muted-foreground">
                showing the 50 newest of {list.length} runs
              </div>
            )}
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
            className="font-mono text-body"
          >
            {reportQ.isLoading
              ? "report…"
              : reportData
                ? reportOpen
                  ? "hide report"
                  : "show report"
                : "no report"}
          </Button>
        )}
        {list.length > 0 && runId === null && (
          <Badge variant="outline" className="font-mono">
            {list.length} runs
          </Badge>
        )}
        {payload.hiddenLegacy > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none font-mono text-body text-muted-foreground hover:text-foreground">
              {payload.hiddenLegacy} legacy run{payload.hiddenLegacy === 1 ? "" : "s"} hidden
            </summary>
            <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-border bg-background p-1 font-mono text-caption text-muted-foreground">
              {payload.legacyRuns.slice(0, 200).map((id) => (
                <li key={id} className="truncate">
                  {id}
                </li>
              ))}
              {payload.legacyRuns.length > 200 && (
                <li className="text-muted-foreground">…{payload.legacyRuns.length - 200} more</li>
              )}
            </ul>
          </details>
        )}
        {runs.error instanceof Error && (
          <span
            className="max-w-[480px] truncate break-words font-mono text-body text-sev-error"
            title={runs.error.message}
          >
            {runs.error.message}
          </span>
        )}
        <label className="ml-auto flex items-center gap-1 font-mono text-caption text-muted-foreground">
          theme
          <Select value={theme} onValueChange={(v) => choose(v as Theme)}>
            <SelectTrigger className="w-fit font-mono text-body" size="sm" aria-label="theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system" className="font-mono text-body">
                system
              </SelectItem>
              <SelectItem value="light" className="font-mono text-body">
                light
              </SelectItem>
              <SelectItem value="dark" className="font-mono text-body">
                dark
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
        {selectedRun !== null && (
          <span
            className="font-mono text-body text-muted-foreground"
            data-testid="header-time"
            title={new Date(selectedRun.mtime).toLocaleString()}
          >
            {relTime(selectedRun.mtime)}
          </span>
        )}
      </header>
      {runId === null ? (
        <div className="m-auto flex max-w-2xl flex-col items-center gap-3 font-mono text-body text-muted-foreground">
          {list.length === 0 ? (
            <p>no runs found - set JINT_REQUESTS_DIR or run jint once</p>
          ) : (
            <>
              {/* heading one scale step above the cards it names (F8) */}
              <p className="text-emphasis text-foreground">select a run</p>
              <div className="flex flex-wrap justify-center gap-2">
                {list.slice(0, 8).map((run) => (
                  <Button
                    key={run.id}
                    variant="outline"
                    size="sm"
                    className="w-72 justify-start font-mono text-body"
                    onClick={() => pick(run.id)}
                    title={`run id: ${run.id}`}
                  >
                    {/* fixed-width cards on one wrap grid; meta right-pinned so its columns
                        line up across every row (F2) */}
                    <span className="min-w-0 truncate">{baseName(run.configPath)}</span>
                    <span className="ml-auto truncate pl-2 text-muted-foreground">
                      · {relTime(run.mtime)} · {run.requests} req
                    </span>
                  </Button>
                ))}
              </div>
              {list.length > 8 && (
                <p className="text-body text-muted-foreground">
                  …{list.length - 8} more in the picker
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {reportOpen && (
            <div id="report-panel">
              <ReportPanel
                runId={runId}
                onRuleFocus={(rule) => {
                  setMode("rule");
                  setFocusRule(rule);
                }}
              />
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <RequestTable
              runId={runId}
              mode={mode}
              onMode={(m) => {
                setMode(m);
                setSelectedPair(null);
              }}
              focusRule={focusRule}
              onFocusHandled={() => setFocusRule(null)}
              selectedFile={selectedPair?.requestFile ?? null}
              onSelectPair={setSelectedPair}
            />
            {selectedPair !== null && (
              <PairDetail
                runId={runId}
                rule={selectedPair.rule}
                input={selectedPair.input}
                requestFile={selectedPair.requestFile}
                onClose={() => setSelectedPair(null)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
