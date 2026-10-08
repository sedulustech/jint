import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { fetchReport } from "../api/client";
import { RunErrors } from "./RunErrors";
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
          <span data-testid="run-marker" className="text-muted-foreground">
            {run.configPath !== null && "config " + baseName(run.configPath)}
            {run.configPath === null && (run.legacy ? "migrated run" : "default rules")}
            {" · "}
            {relTime(run.mtime)}
            {run.ruleCount > 0 &&
              fileCount > 0 &&
              ` · ${run.ruleCount} rules · ${fileCount} files`}{" "}
            · id: {run.id.slice(-6)}
          </span>
        )}
        {runErrors.length > 0 && (
          <Button
            variant="ghost"
            size="icon-xs"
            data-testid="run-errors-toggle"
            aria-expanded={errorsOpen}
            aria-controls="run-errors"
            onClick={() => setErrorsOpen((o) => !o)}
            className="text-sev-error"
            title={runErrors[0]!.message}
          >
            <TriangleAlert className="size-3.5" />
          </Button>
        )}
      </div>
      {errorsOpen && runErrors.length > 0 && <RunErrors errors={runErrors} />}
    </>
  );
}
