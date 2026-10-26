import { useState } from "react";
import { PairDetail } from "./PairDetail";
import type { ClassifyErrorInfo } from "../types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The expanded run-errors section: setup failures that left part of the run unmeasured. Lives under
 * the run header, opens from the warning toggle. Same row anatomy as the report table: background
 * surface, rail-gutter rows, hairline separators. An error that names its rule opens that pair's
 * request in a dialog: the question asked and the code it was asked about.
 */
export function RunErrors({
  runId,
  errors,
}: {
  runId: string;
  errors: readonly ClassifyErrorInfo[];
}) {
  const [opened, setOpened] = useState<ClassifyErrorInfo | null>(null);
  return (
    <div
      id="run-errors"
      className="shrink-0 border-b border-border bg-background py-inner text-body"
    >
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
                  onClick={() => setOpened(e)}
                >
                  request
                </Button>
              )}
            </div>
            <p className="whitespace-normal text-body text-muted-foreground">{e.message}</p>
          </li>
        ))}
      </ul>
      <Dialog open={opened !== null} onOpenChange={(open) => open || setOpened(null)}>
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
                onClose={() => setOpened(null)}
              />
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
