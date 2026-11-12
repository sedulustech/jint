import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { fetchRuns } from "./api/client";
import { NotFound } from "./router";
import { ClassificationDetail } from "./views/ClassificationDetail";
import { Nav } from "./views/Nav";
import { ReportHeader } from "./views/ReportHeader";
import { RequestTable } from "./views/RequestTable";
import { ERRORS_ROUTE, useErrorsRoute } from "./views/RunErrors";
import { RunFacts, RunHeader, baseName, relTime, runLabel } from "./views/RunHeader";
import { ThemeButtons } from "./views/ThemeButtons";
import { useTheme } from "./views/useTheme";
import type { RunSearch } from "./router";
import type { RunSummary } from "./types";
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
  // opening the picker always shows fresh runs: invalidate so the runs query refetches
  const queryClient = useQueryClient();

  // ctrl/cmd+K toggles the picker, the way every editor does it
  useEffect(function togglePickerOnShortcut() {
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
        className="min-w-0 max-w-full text-body"
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
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void queryClient.invalidateQueries({ queryKey: ["runs"] });
        }}
        title="run picker"
        description="filter runs by path"
        className="sm:max-w-[80%]"
      >
        <Command>
          <CommandInput placeholder="filter runs by path…" />
          <CommandList className="max-h-[36rem]">
            <CommandEmpty>no runs match</CommandEmpty>
            {runList.slice(0, MAX_RUNS).map((run) => (
              <CommandItem
                key={run.id}
                value={`${runLabel(run)} ${run.configPath ?? ""} ${run.id}`}
                data-testid={`run-option-${run.id}`}
                className="min-w-0 py-siblings text-body"
                title={`${runLabel(run)}\nrun id: ${run.id}`}
                onSelect={() => {
                  onPick(run.id);
                  setOpen(false);
                }}
              >
                <RunFacts run={run} title={runLabel(run)} />
              </CommandItem>
            ))}
            {runList.length > MAX_RUNS && (
              <div className="px-inner py-related text-caption text-muted-foreground">
                showing the {MAX_RUNS} newest of {runList.length} runs
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

const reportSearchEditFailure = (cause: unknown): void => {
  // oxlint-disable-next-line no-console
  console.error(new Error("run search edit failed", { cause }));
};

function navigationFor(runId: string | null, route: RunRoute, searchChange: Partial<RunSearch>) {
  const search = (previousSearch: RunSearch) => ({ ...previousSearch, ...searchChange });
  return runId === null ? { to: "/", search } : { to: route, params: { runId }, search };
}

function useSequentialSearchEdit(
  runId: string | null,
): (searchChange: Partial<RunSearch>, route?: RunRoute) => Promise<unknown> {
  const navigate = useNavigate();
  const pendingNavigation = useRef<Promise<unknown>>(Promise.resolve());
  return (searchChange: Partial<RunSearch>, route: RunRoute = RUN_ROUTE): Promise<unknown> => {
    const edit = pendingNavigation.current.then(() =>
      navigate(navigationFor(runId, route, searchChange)),
    );
    pendingNavigation.current = edit.then(undefined, reportSearchEditFailure);
    return edit;
  };
}

function RunLanding({ runList, onPick }: { runList: RunSummary[]; onPick: (id: string) => void }) {
  return (
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
                onClick={() => onPick(run.id)}
                title={`run id: ${run.id}`}
              >
                {/* fixed-width cards on one wrap grid; meta right-pinned so its columns
                    line up across every row (F2) */}
                <span className="min-w-0 truncate">{runLabel(run)}</span>
                <span className="ml-auto truncate pl-related text-muted-foreground">
                  {run.model !== undefined && ` · ${run.model}`}
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
  );
}

const DEFAULT_MODE: Mode = "file";
const RUN_ROUTE = "/runs/$runId";
type RunRoute = typeof RUN_ROUTE | typeof ERRORS_ROUTE;
const MAX_RUNS = 100;

function AppHeader({
  picker,
  runCount,
  error,
}: {
  picker: React.ReactNode;
  runCount: number | null;
  error: Error | null;
}) {
  const { theme, choose } = useTheme();
  return (
    <header className="flex shrink-0 items-center gap-sections border-b border-border bg-muted px-rail py-bar-y">
      <h1 className="flex items-center text-foreground">
        <Logo className="h-6 w-auto" />
      </h1>
      <Nav />
      <div className="min-w-0 flex-1">{picker}</div>
      {runCount !== null && <Badge variant="secondary">{runCount} runs</Badge>}
      {error !== null && (
        <span
          className="max-w-[480px] truncate break-words text-body text-sev-error"
          title={error.message}
        >
          {error.message}
        </span>
      )}
      <ThemeButtons theme={theme} choose={choose} />
    </header>
  );
}

type Selection = { rule: string; input: string; requestFile: string | undefined };
type SelectionAddress = { rule: string; input: string; requestFile?: string };

/** The classification the URL addresses, and the way to change it. */
function useSelectedClassification(runId: string): {
  selectedClassification: Selection | null;
  setSelectedClassification: (address: SelectionAddress | null) => Promise<unknown>;
} {
  const search = useSearch({ strict: false }) as RunSearch;
  // on the errors route rule/input address the errors dialog, not the pane
  const errorsOpen = useErrorsRoute();
  // the detail pane is addressed by a rule at an input, never by request identity;
  // its identity lives in the URL (search params) so a pane deep-links + survives reload
  const selectedClassification =
    search.rule !== undefined && !errorsOpen
      ? { rule: search.rule, input: search.input ?? "", requestFile: search.file }
      : null;
  const editSearch = useSequentialSearchEdit(runId);
  const setSelectedClassification = (address: SelectionAddress | null) =>
    editSearch(
      address === null
        ? { rule: undefined, input: undefined, file: undefined }
        : { rule: address.rule, input: address.input, file: address.requestFile },
    );
  return { selectedClassification, setSelectedClassification };
}

function RunView({ runId, hasRun }: { runId: string; hasRun: boolean }) {
  const { selectedClassification, setSelectedClassification } = useSelectedClassification(runId);
  const [viewMode, setViewMode] = useState<Mode>(DEFAULT_MODE);
  useEffect(
    function resetViewModeOnRunChange() {
      setViewMode(DEFAULT_MODE);
    },
    [runId],
  );

  return (
    <>
      {hasRun && <ReportHeader runId={runId} />}
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
              setSelectedClassification(null);
            }}
            selectedFile={selectedClassification?.requestFile ?? null}
            onSelectClassification={setSelectedClassification}
          />
        </ResizablePanel>
        {selectedClassification !== null && (
          <>
            <ResizableHandle withHandle aria-label="resize rules and result panes" />
            <ResizablePanel
              id="detail"
              order={2}
              defaultSize={40}
              minSize={25}
              className="flex min-h-0 min-w-0 flex-col overflow-auto"
            >
              <ClassificationDetail
                runId={runId}
                rule={selectedClassification.rule}
                input={selectedClassification.input}
                requestFile={selectedClassification.requestFile}
                onClose={() => setSelectedClassification(null)}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </>
  );
}

function useRunList(runId: string | null): {
  runList: RunSummary[];
  selectedRun: RunSummary | null;
  loading: boolean;
  error: Error | null;
} {
  // Poll while a run is in flight: new runs appear mid-run without reopening the picker. The
  // summary fetch is compressed ~10x on the wire, so a short interval is cheap; it stops when the
  // tab is hidden (react-query default) and errors keep the last good list.
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: fetchRuns,
    refetchInterval: 5_000,
  });
  // Shape guard: the endpoint must answer { runs }. A contract slip degrades to an empty
  // list + hint, never a white screen.
  const runList: RunSummary[] = runs.data && Array.isArray(runs.data.runs) ? runs.data.runs : [];
  return {
    runList,
    selectedRun: runList.find((r) => r.id === runId) ?? null,
    loading: runs.isLoading,
    error: runs.error instanceof Error ? runs.error : null,
  };
}

export function App({ runId }: { runId: string | null }) {
  const navigate = useNavigate();
  const { runList, selectedRun, loading, error } = useRunList(runId);

  const pickRun = (pickedRunId: string) => {
    // picking (or clearing) a run resets the pane state with it. Branched whole literals: the
    // router serializes params, so an explicit undefined param is not the same as absent.
    navigate(
      pickedRunId === ""
        ? { to: "/", search: {} as RunSearch }
        : { to: RUN_ROUTE, params: { runId: pickedRunId }, search: {} as RunSearch },
    );
  };

  // the run list IS the presence check (there is no per-id gate): a well-formed route to an
  // absent id renders the shared 404 idiom inside the shell
  const runMissing = runId !== null && !loading && error === null && selectedRun === null;
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader
        picker={
          // the picker lives in the page header beside the logo, where the path has the room
          <RunPicker
            runList={runList}
            runsLoading={loading}
            selectedRun={selectedRun}
            onPick={pickRun}
          />
        }
        runCount={runList.length > 0 && runId === null ? runList.length : null}
        error={error}
      />
      <RunHeader run={selectedRun} />
      {runMissing ? (
        <NotFound title={`run ${runId} not found`} detail="gone or never existed" />
      ) : runId === null ? (
        <RunLanding runList={runList} onPick={pickRun} />
      ) : (
        <RunView runId={runId} hasRun={selectedRun !== null} />
      )}
    </div>
  );
}
