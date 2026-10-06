import { formatDistanceToNowStrict } from "date-fns";
import type { RunSummary } from "../types";

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
export function RunHeader({ run }: { run: RunSummary }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-meta border-b border-border px-rail py-bar-y font-mono text-body">
      <span className="text-emphasis text-foreground">{runLabel(run)}</span>
      <span className="text-muted-foreground">
        {run.configPath !== null && "config " + baseName(run.configPath)}
        {run.configPath === null && (run.legacy ? "migrated run" : "default rules")}
        {" · "}
        {relTime(run.mtime)} · {run.requests} req · {run.id.slice(-6)}
      </span>
    </div>
  );
}
