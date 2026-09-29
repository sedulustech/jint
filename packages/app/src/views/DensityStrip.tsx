import { isScoreHandler, type HandlerData } from "@jint/contract";
import { useMemo } from "react";
import type { RequestSummary } from "../types";

// bins; a 1px-per-request strip bins down for 2000+ rows
const WIDTH = 240;
/**
 * Threshold values from the active rule's handle snapshot: already p-space (the operator carries
 * the direction), so no mapping. Score handles index criteria, not p: no marks.
 */
export function marksFor(handle: HandlerData | undefined): number[] {
  // score poles are indices, not p-space: no marks for score handles
  if (handle === undefined || isScoreHandler(handle)) return [];
  const at: number[] = [];
  for (const cond of [handle.warn, handle.error]) {
    if (cond === undefined) continue;
    if (cond.greater_than !== undefined) at.push(cond.greater_than);
    if (cond.less_than !== undefined) at.push(cond.less_than);
  }
  return at;
}

/**
 * Distribution of one probability per request (the capture's max answer) across 0..1. The 0.5
 * boundary is the strong line; when the table is filtered to ONE rule, its handle's thresholds
 * appear as faint marks.
 */
export function DensityStrip({
  rows,
  marks = [],
  scoreAxis,
}: {
  rows: RequestSummary[];
  marks?: number[];
  /** When the filtered rule is a score handle: its level count, so the axis reads honestly. */
  scoreAxis?: number;
}) {
  const bins = useMemo(() => {
    const b = new Array(WIDTH).fill(0);
    for (const r of rows) {
      if (r.maxProb === null) continue;
      b[Math.min(WIDTH - 1, Math.floor(r.maxProb * WIDTH))] += 1;
    }
    return b;
  }, [rows]);
  const max = Math.max(1, ...bins);

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-1">
      <span className="shrink-0 font-mono text-caption text-muted-foreground">
        distribution of max-p over {rows.length} requests
        {scoreAxis !== undefined && ` (score/${scoreAxis - 1} scaled to 0…1)`}
      </span>
      <div
        className="relative h-8 min-w-0 flex-1 overflow-hidden"
        title={
          scoreAxis !== undefined
            ? `x: score/${scoreAxis - 1} normalized 0..1 · the 0.5 line sits between the middle levels`
            : "x: answer probability 0..1 · strong line 0.5 · faint lines: the active rule's thresholds"
        }
      >
        <div className="absolute inset-0 flex items-end">
          {bins.map((n, i) => (
            <div
              key={i}
              className="w-full min-w-0 flex-1 bg-[var(--chart-bar)]"
              style={{ height: `${(n / max) * 100}%`, minHeight: n > 0 ? 1 : 0 }}
            />
          ))}
        </div>
        <div
          className="absolute bottom-0 top-0 w-px bg-[var(--chart-ref)]"
          style={{ left: "50%" }}
        />
        {marks.map((t) => (
          <div
            key={t}
            className="absolute bottom-0 top-0 w-px bg-[var(--chart-mark)]"
            style={{ left: `${t * 100}%` }}
          />
        ))}
        <span className="absolute left-1/2 top-0 -translate-x-1/2 bg-background px-0.5 font-mono text-caption leading-none text-foreground">
          0.5
        </span>
      </div>
      <span className="shrink-0 font-mono text-caption text-muted-foreground">0 … 1</span>
    </div>
  );
}

/**
 * Mini distribution for a group parent row: one bin per value bin across 0..1 with the 0.5 ref line
 * and the rule's threshold marks. Shape, not verdict.
 */
export function MiniStrip({ values, marks = [] }: { values: number[]; marks?: number[] }) {
  const BINS = 24;
  const bins = useMemo(() => {
    const b = new Array(BINS).fill(0);
    for (const v of values) b[Math.min(BINS - 1, Math.floor(v * BINS))] += 1;
    return b;
  }, [values]);
  const max = Math.max(1, ...bins);
  return (
    <div
      className="relative h-2.5 w-28 shrink-0"
      title="distribution of cell values 0..1 · line 0.5"
    >
      <div className="absolute inset-0 flex items-end gap-px">
        {bins.map((n, i) => (
          <div
            key={i}
            className="min-w-px flex-1 bg-[var(--chart-bar)]"
            style={{ height: `${(n / max) * 100}%`, minHeight: n > 0 ? 1 : 0 }}
          />
        ))}
      </div>
      <div className="absolute bottom-0 top-0 w-px bg-[var(--chart-ref)]" style={{ left: "50%" }} />
      {marks.map((t) => (
        <div
          key={t}
          className="absolute bottom-0 top-0 w-px bg-[var(--chart-mark)]"
          style={{ left: `${t * 100}%` }}
        />
      ))}
    </div>
  );
}
