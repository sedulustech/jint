import { useMatch, useNavigate, useSearch } from "@tanstack/react-router";
import { PairDetail } from "./PairDetail";
import type { RunSearch } from "../router";
import type { ClassifyErrorInfo } from "../types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// the errors route id: a child of the run route, so the run view keeps rendering underneath
export const ERRORS_ROUTE = "/runs/$runId/errors";

/** Whether the address is the run's errors route (the list is open). */
export const useErrorsRoute = (): boolean =>
  useMatch({ from: ERRORS_ROUTE, shouldThrow: false }) !== undefined;

/**
 * The expanded run-errors section: setup failures that left part of the run unmeasured. Lives under
 * the run header, open while the address is /runs/$runId/errors. Same row anatomy as the report
 * table: background surface, rail-gutter rows, hairline separators. An error that names its rule
 * opens that pair's request in a dialog: the question asked and the code it was asked about. The
 * dialog's pair is addressed by ?rule&input on the errors route, so Back closes it.
 */
export function RunErrors({
  runId,
  errors,
}: {
  runId: string;
  errors: readonly ClassifyErrorInfo[];
}) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as RunSearch;
  // only report= carries over: rule/input on this route address the dialog, not the pane
  const openAt = (pair: { rule: string; input: string } | null) =>
    navigate({
      to: ERRORS_ROUTE,
      params: { runId },
      search: (previousSearch: RunSearch) => {
        const next: RunSearch = {};
        if (previousSearch.report !== undefined) next.report = previousSearch.report;
        if (pair !== null) Object.assign(next, pair);
        return next;
      },
    });
  const addressed = search.rule !== undefined;
  const opened = addressed
    ? errors.find((e) => e.rule === search.rule && e.input === search.input)
    : undefined;
  return (
    <div
      id="run-errors"
      className="shrink-0 border-b border-border bg-background py-inner text-body"
    >
      {addressed && opened === undefined && (
        <p data-testid="run-error-missing" className="px-rail py-related text-muted-foreground">
          no such error
        </p>
      )}
      <ul className="flex flex-col">
        {errors.map((e, i) => (
          <li key={i} className="border-b border-border px-rail py-related last:border-b-0">
            <div className="flex items-baseline gap-siblings">
              <span className="truncate text-foreground">{e.input}</span>
              <span className="shrink-0 text-caption font-bold text-sev-error">{e.code}</span>
              {e.rule !== undefined && (
                <Button
                  variant="secondary"
                  size="xs"
                  data-testid="run-error-open"
                  aria-label={`open ${e.rule} at ${e.input}`}
                  onClick={() => openAt({ rule: e.rule!, input: e.input })}
                >
                  request
                </Button>
              )}
            </div>
            <p className="whitespace-normal text-body text-muted-foreground">{e.message}</p>
          </li>
        ))}
      </ul>
      <Dialog open={opened !== undefined} onOpenChange={(open) => open || openAt(null)}>
        {opened?.rule !== undefined && (
          <DialogContent
            showCloseButton={false}
            className="flex max-h-[80%] flex-col gap-0 overflow-hidden p-0 sm:max-w-[80%]"
          >
            <DialogHeader className="sr-only">
              <DialogTitle>
                {opened.rule} at {opened.input}
              </DialogTitle>
              <DialogDescription>{opened.message}</DialogDescription>
            </DialogHeader>
            <div className="flex shrink-0 items-baseline gap-siblings px-rail py-related">
              <span className="shrink-0 text-caption font-bold text-sev-error">{opened.code}</span>
              <p className="whitespace-normal text-body text-muted-foreground">{opened.message}</p>
            </div>
            <div className="min-h-0 flex-1">
              <PairDetail
                runId={runId}
                rule={opened.rule}
                input={opened.input}
                onClose={() => openAt(null)}
              />
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
