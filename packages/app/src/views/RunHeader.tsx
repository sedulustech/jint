import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { fetchReport } from "../api/client";
import type { Report, RunSummary } from "../types";
export const baseName = (path: string) => path.split("/").pop() ?? path;

/**
 * Dropdown label: the run's source tree (cwd, already ~-collapsed by the handler). A migrated
 * pre-store run has no cwd/config - label it honestly instead of faking "default rules".
 */
export const runLabel = (r: RunSummary): string =>
  r.legacy ? "migrated run" : (r.cwd ?? r.configPath ?? "default rules");

export const relTime = (mtime: string) =>
  `${formatDistanceToNowStrict(new Date(mtime), { addSuffix: true })}`;

/**
 * The run's identity as a strip above the report section - the data the picker trigger used to cram
 * into one line. The trigger slims to label + chevron; the full identity lives here.
 */
export function RunHeader({ run, picker }: { run: RunSummary | null; picker: React.ReactNode }) {
  const [errorsOpen, setErrorsOpen] = useState(false);
  const reportQuery = useQuery({
    queryKey: ["report", run?.id],
    queryFn: () => fetchReport(run!.id),
    enabled: run !== null,
  });
  const report = reportQuery.data;
  const runErrors = report !== undefined && !("absent" in report) ? (report as Report).errors : [];

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-meta border-b border-border px-rail py-bar-y text-body">
        {picker}
        {run !== null && (
          <span data-testid="run-marker" className="text-muted-foreground">
            {run.configPath !== null && "config " + baseName(run.configPath)}
            {run.configPath === null && (run.legacy ? "migrated run" : "default rules")}
            {" · "}
            {relTime(run.mtime)} · id: {run.id.slice(-6)}
          </span>
        )}
        {runErrors.length > 0 && (
          <button
            type="button"
            data-testid="run-errors-toggle"
            aria-expanded={errorsOpen}
            aria-controls="run-errors"
            onClick={() => setErrorsOpen((o) => !o)}
            className="flex items-center gap-related text-sev-error"
            title={runErrors[0]!.message}
          >
            {errorsOpen ? (
              <ChevronDown className="size-3.5 shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" />
            )}
            <TriangleAlert className="size-3.5 shrink-0" />
            {runErrors.length}
          </button>
        )}
      </div>
      {errorsOpen && runErrors.length > 0 && (
        <div
          id="run-errors"
          className="flex shrink-0 flex-col gap-related border-b border-border bg-muted px-rail py-related"
        >
          {runErrors.map((e, i) => (
            <div key={i} className="min-w-0">
              <div className="flex items-center gap-related">
                <span className="text-caption font-bold text-sev-error">{e.code}</span>
                <span className="truncate text-foreground">{e.input}</span>
              </div>
              <p className="whitespace-normal text-body text-muted-foreground">{e.message}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
