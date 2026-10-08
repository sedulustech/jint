import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchReport, fetchRuns } from "./api/client";
import { NotFound } from "./router";
import { PairDetail } from "./views/PairDetail";
import { ReportHeader } from "./views/ReportHeader";
import { ReportPanel } from "./views/ReportPanel";
import { RequestTable } from "./views/RequestTable";
import { RunHeader, baseName, relTime, runLabel } from "./views/RunHeader";
import { useTheme } from "./views/useTheme";
import type { RunSearch } from "./router";
import type { Report, RunSummary } from "./types";
import type { Mode } from "./views/useRun";
import { Logo } from "@/components/Logo";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
function RunPicker({
  runList,
  runsLoading,
  selectedRun,
  onPick,
}: {
  runList: RunSummary[];
  runsLoading: boolean;
  selectedRun: RunSummary | null;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // ctrl/cmd+K toggles the palette, the way every editor does it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        data-testid="run-picker"
        aria-expanded={open}
        aria-label="run"
        onClick={() => setOpen(true)}
        className="max-w-64 text-body"
      >
        <span className="truncate">
          {selectedRun === null
            ? runsLoading
              ? "loading runs…"
              : `select a run (${runList.length})`
            : runLabel(selectedRun)}
        </span>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="run picker"
        description="filter runs by path"
        className="sm:max-w-[80%]"
      >
        <Command>
          <CommandInput placeholder="filter runs by path…" />
          <CommandList>
            <CommandEmpty>no runs match</CommandEmpty>
            {runList.slice(0, 50).map((run) => (
              <CommandItem
                key={run.id}
                value={`${runLabel(run)} ${run.configPath ?? ""} ${run.id}`}
                data-testid={`run-option-${run.id}`}
                className="min-w-0 text-body"
                title={`${runLabel(run)}\nrun id: ${run.id}`}
                onSelect={() => {
                  onPick(run.id);
                  setOpen(false);
                }}
              >
                <span className="truncate text-foreground">{runLabel(run)}</span>
                <span className="truncate text-muted-foreground">
                  {run.configPath !== null && ` · ${baseName(run.configPath)}`}
                  {run.configPath === null &&
                    (run.legacy ? " · migrated run" : " · default rules")}{" "}
                  · {relTime(run.mtime)} · {run.requests}{" "}
                  {run.requests === 1 ? "request" : "requests"} · id:
                  {run.id.slice(-6)}
                </span>
              </CommandItem>
            ))}
            {runList.length > 50 && (
              <div className="px-inner py-related text-caption text-muted-foreground">
                showing the 50 newest of {runList.length} runs
              </div>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

// a failed URL edit leaves the pane state stale; say so loudly instead of rethrowing
// into a promise no caller awaits
const reportSearchEditFailure = (cause: unknown): void => {
  // oxlint-disable-next-line no-console
  console.error("run search edit failed", { cause });
};

export function App({ runId }: { runId: string | null }) {
  const { theme, choose } = useTheme();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as RunSearch;
  // the detail pane is addressed by a rule-target pair, never by request identity;
  // its identity lives in the URL (search params) so a pane deep-links + survives reload
  const selectedPair =
    search.rule !== undefined
      ? { rule: search.rule, input: search.input ?? "", requestFile: search.file }
      : null;
  const [viewMode, setViewMode] = useState<Mode>("rule");
  // one-shot: a report-panel click expands + scrolls to the rule's group in rule mode
  const [focusedRule, setFocusedRule] = useState<string | null>(null);
  const reportOverride = search.report === undefined ? null : search.report === 1;
  const runs = useQuery({ queryKey: ["runs"], queryFn: fetchRuns });
  const reportQuery = useQuery({
    queryKey: ["report", runId],
    queryFn: () => fetchReport(runId ?? ""),
    enabled: runId !== null,
  });
  const reportData =
    reportQuery.data && !("absent" in reportQuery.data) ? (reportQuery.data as Report) : undefined;
  // only a fetched report lets the panel open; a URL choice cannot conjure a missing one
  const reportOpen = reportData !== undefined && (reportOverride ?? true);
  // Shape guard: the endpoint must answer { runs }. A contract slip degrades to an empty
  // list + hint, never a white screen.
  const runList: RunSummary[] = runs.data && Array.isArray(runs.data.runs) ? runs.data.runs : [];
  const selectedRun = runList.find((r) => r.id === runId) ?? null;

  // a new run resets the user's overrides so the default-open rule applies fresh
  const resetPanelState = () => {
    setViewMode("rule");
    setFocusedRule(null);
  };
  useEffect(resetPanelState, [runId]);

  const pickRun = (pickedRunId: string) => {
    // picking (or clearing) a run resets the panel state with it
    navigate({
      to: pickedRunId === "" ? "/" : "/runs/$runId",
      ...(pickedRunId === "" ? {} : { params: { runId: pickedRunId } }),
      search: {} as RunSearch,
    });
  };

  // panel toggles are URL edits so back/forward walks run + panel history.
  // RAPID navigations get dropped: while one commit is in flight the router
  // dedupes the next against the stale latestLocation (toggle hide->show
  // within a commit window loses the second click). Serialize them so every
  // click lands, in order.
  const pendingNavigation = useRef<Promise<unknown>>(Promise.resolve());
  const editSearch = (searchChange: Partial<RunSearch>): Promise<unknown> => {
    pendingNavigation.current = pendingNavigation.current
      .then(() =>
        navigate({
          to: runId === null ? "/" : "/runs/$runId",
          ...(runId === null ? {} : { params: { runId } }),
          search: (previousSearch: RunSearch) => ({ ...previousSearch, ...searchChange }),
        }),
      )
      .catch(reportSearchEditFailure);
    return pendingNavigation.current;
  };
  const setReportOverride = (reportChoice: boolean | null) => {
    editSearch({ report: reportChoice === null ? undefined : reportChoice ? 1 : 0 });
  };
  const setSelectedPair = (pair: { rule: string; input: string; requestFile?: string } | null) =>
    editSearch(
      pair === null
        ? { rule: undefined, input: undefined, file: undefined }
        : { rule: pair.rule, input: pair.input, file: pair.requestFile },
    );

  // the picker lives in the RunHeader strip, left of the run details
  const picker = (
    <RunPicker
      runList={runList}
      runsLoading={runs.isLoading}
      selectedRun={selectedRun}
      onPick={pickRun}
    />
  );
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-sections border-b border-border bg-muted px-rail py-bar-y">
        <h1 className="flex items-center text-foreground">
          <Logo className="h-6 w-auto" />
        </h1>
        {runList.length > 0 && runId === null && (
          <Badge variant="secondary">{runList.length} runs</Badge>
        )}
        {runs.error instanceof Error && (
          <span
            className="max-w-[480px] truncate break-words text-body text-sev-error"
            title={runs.error.message}
          >
            {runs.error.message}
          </span>
        )}
        <div className="ml-auto flex items-center gap-related" role="group" aria-label="theme">
          {(
            [
              ["system", Monitor],
              ["light", Sun],
              ["dark", Moon],
            ] as const
          ).map(([m, Icon]) => (
            <Button
              key={m}
              variant="secondary"
              size="icon-xs"
              data-testid={`theme-${m}`}
              aria-label={`${m} theme`}
              aria-pressed={theme === m}
              title={`${m} theme`}
              onClick={() => choose(m)}
              className={theme === m ? undefined : "border border-input"}
            >
              <Icon />
            </Button>
          ))}
        </div>
      </header>
      <RunHeader run={selectedRun} picker={picker} />
      {runId !== null && !runs.isLoading && runs.error == null && selectedRun === null ? (
        // the run list IS the presence check (there is no per-id gate): a well-formed
        // route to an absent id renders the shared 404 idiom inside the shell
        <NotFound title={`run ${runId} not found`} detail="gone or never existed" />
      ) : runId === null ? (
        <div className="m-auto flex max-w-2xl flex-col items-center gap-sections text-body text-muted-foreground">
          {runList.length === 0 ? (
            <p>no runs found - run jint once (store: ~/.jint/runs)</p>
          ) : (
            <>
              {/* heading one scale step above the cards it names (F8) */}
              <p data-testid="run-picker-heading" className="text-emphasis text-foreground">
                select a run
              </p>
              <div className="flex flex-wrap justify-center gap-siblings">
                {runList.slice(0, 8).map((run) => (
                  <Button
                    key={run.id}
                    variant="secondary"
                    size="sm"
                    className="w-72 justify-start text-body"
                    onClick={() => pickRun(run.id)}
                    title={`run id: ${run.id}`}
                  >
                    {/* fixed-width cards on one wrap grid; meta right-pinned so its columns
                        line up across every row (F2) */}
                    <span className="min-w-0 truncate">{runLabel(run)}</span>
                    <span className="ml-auto truncate pl-related text-muted-foreground">
                      {run.configPath !== null && ` · ${baseName(run.configPath)}`}
                      {run.configPath === null &&
                        (run.legacy ? " · migrated run" : " · default rules")}{" "}
                      · {relTime(run.mtime)} · {run.requests} req
                    </span>
                  </Button>
                ))}
              </div>
              {runList.length > 8 && (
                <p className="text-body text-muted-foreground">
                  …{runList.length - 8} more in the picker
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {selectedRun !== null && (
            <ReportHeader
              runId={runId}
              reportOpen={reportOpen}
              onToggleReport={() => setReportOverride(!reportOpen)}
            />
          )}
          {reportOpen && (
            <div id="report-panel">
              <ReportPanel
                runId={runId}
                onRuleFocus={(rule) => {
                  setViewMode("rule");
                  setFocusedRule(rule);
                }}
              />
            </div>
          )}
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="jint-rules-detail"
            className="min-h-0 flex-1"
          >
            <ResizablePanel
              id="rules"
              order={0}
              defaultSize={60}
              minSize={20}
              className="flex min-h-0 min-w-0 flex-col"
            >
              <RequestTable
                runId={runId}
                mode={viewMode}
                onMode={(m) => {
                  setViewMode(m);
                  setSelectedPair(null);
                }}
                focusRule={focusedRule}
                onFocusHandled={() => setFocusedRule(null)}
                selectedFile={selectedPair?.requestFile ?? null}
                onSelectPair={setSelectedPair}
              />
            </ResizablePanel>
            {selectedPair !== null && (
              <>
                <ResizableHandle withHandle aria-label="resize rules and result panes" />
                <ResizablePanel
                  id="detail"
                  order={2}
                  defaultSize={40}
                  minSize={25}
                  className="flex min-h-0 min-w-0 flex-col overflow-auto"
                >
                  <PairDetail
                    runId={runId}
                    rule={selectedPair.rule}
                    input={selectedPair.input}
                    requestFile={selectedPair.requestFile}
                    onClose={() => setSelectedPair(null)}
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </>
      )}
    </div>
  );
}
