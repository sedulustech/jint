import { useMemo } from "react";
import type { RequestItem } from "../types";

// bins; a 1px-per-request strip bins down for 2000+ rows
const WIDTH = 240;

/**
 * Distribution of one probability per request (the request's max answer) across 0..1. The 0.5
 * boundary is the strong line; when the table is filtered to ONE rule, its handle's thresholds
 * appear as faint marks.
 */
export function DensityStrip({
  rows,
  marks = [],
  scoreAxis,
}: {
  rows: RequestItem[];
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
