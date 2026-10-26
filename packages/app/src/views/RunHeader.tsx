import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { TriangleAlert } from "lucide-react";
import { fetchReport } from "../api/client";
import { ERRORS_ROUTE, RunErrors, useErrorsRoute } from "./RunErrors";
import type { RunSearch } from "../router";
import type { Report, RunSummary } from "../types";
import { Button } from "@/components/ui/button";
export const baseName = (path: string) => path.split("/").pop() ?? path;

/**
 * Dropdown label: the run's source tree (cwd, already ~-collapsed by the handler). A migrated
 * pre-store run has no cwd/config - label it honestly instead of faking "default rules".
 */
export const runLabel = (r: RunSummary): string =>
  r.legacy ? "migrated run" : (r.cwd ?? r.configPath ?? "default rules");

export const relTime = (mtime: string) =>
  `${formatDistanceToNowStrict(new Date(mtime), { addSuffix: true })}`;

/** Duration as e.g. "41s" or "1m 12s"; null when the run predates duration recording. */
export const runDuration = (ms: number | undefined): string | null =>
  ms === undefined
    ? null
    : ms < 1000
      ? `${ms}ms`
      : ms < 60_000
        ? `${Math.round(ms / 100) / 10}s`
        : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;

/**
 * The run's identity as a strip above the report section - the data the picker trigger used to cram
 * into one line. The trigger slims to label + chevron; the full identity lives here.
 */
export function RunHeader({ run, picker }: { run: RunSummary | null; picker: React.ReactNode }) {
  // the errors list is a route, not local state: the toggle walks /runs/$runId <-> /errors
  const errorsOpen = useErrorsRoute();
  const navigate = useNavigate();
  const reportQuery = useQuery({
    queryKey: ["report", run?.id],
    queryFn: () => fetchReport(run!.id),
    enabled: run !== null,
  });
  const report = reportQuery.data;
  const runErrors = report !== undefined && !("absent" in report) ? (report as Report).errors : [];
  // distinct measured files - the element identity is path#span, the file tier is the bare path
  const fileCount =
    report !== undefined && !("absent" in report)
      ? new Set((report as Report).measurements.map((m) => m.input.split("#")[0])).size
      : 0;

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-meta border-b border-border px-rail py-bar-y text-body">
        {picker}
        {run !== null && (
          <span
            data-testid="run-marker"
            className="flex flex-wrap items-center gap-related text-muted-foreground"
          >
            {run.model !== undefined && (
              <>
                <span data-testid="run-model">{run.model}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>
              {run.configPath !== null && "config " + baseName(run.configPath)}
              {run.configPath === null && (run.legacy ? "migrated run" : "default rules")}
            </span>
            <span aria-hidden="true">·</span>
            <span>{relTime(run.mtime)}</span>
            {run.ruleCount > 0 && fileCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {run.ruleCount} rules · {fileCount} files
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>id: {run.id.slice(-6)}</span>
            {runDuration(run.durationMs) !== null && run.usage !== undefined && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {runDuration(run.durationMs)} · {run.usage.input.toLocaleString()} in /{" "}
                  {run.usage.output.toLocaleString()} out tokens
                  {(run.usage.cached ?? 0) > 0 && ` (${run.usage.cached!.toLocaleString()} cached)`}
                </span>
              </>
            )}
            {run.cost !== undefined && (
              <>
                <span aria-hidden="true">·</span>
                <span data-testid="run-cost">${run.cost.toFixed(4)}</span>
              </>
            )}
          </span>
        )}
        {runErrors.length > 0 && (
          <Button
            variant="ghost"
            size="icon-xs"
            data-testid="run-errors-toggle"
            aria-expanded={errorsOpen}
            aria-controls="run-errors"
            onClick={() =>
              run !== null &&
              navigate({
                to: errorsOpen ? "/runs/$runId" : ERRORS_ROUTE,
                params: { runId: run.id },
                // only report= carries over: rule/input address the pane on the run route and
                // the dialog on the errors route, so neither survives the switch
                search: (previousSearch: RunSearch) =>
                  previousSearch.report === undefined ? {} : { report: previousSearch.report },
              })
            }
            className="text-sev-error"
            title={runErrors[0]!.message}
          >
            <TriangleAlert className="size-3.5" />
          </Button>
        )}
      </div>
      {errorsOpen && run !== null && runErrors.length > 0 && (
        <RunErrors runId={run.id} errors={runErrors} />
      )}
    </>
  );
}
