import { memo } from "react";
import { SEVERITY } from "./color";
import { REQ_COLS } from "./requestCols";
import type { RequestSummary } from "../types";

// width map from the shared spec: the row cells and the header columns read the same
// source, so a column change in requestCols.ts cannot leave the rows misaligned.
const W = Object.fromEntries(REQ_COLS.map((c) => [c.key, c.width])) as Record<
  (typeof REQ_COLS)[number]["key"],
  string
>;

const SEV_CELL = { error: { label: "error" }, warn: { label: "warn" } } as const;

interface Props {
  row: RequestSummary;
  height: number;
  selected: boolean;
  severity: "error" | "warn" | null;
  onSelect: () => void;
}

export const Row = memo(function Row({ row, height, selected, severity, onSelect }: Props) {
  const sev = severity !== null ? SEVERITY[severity] : null;
  const tint = selected ? "bg-accent text-accent-foreground" : sev ? sev.row : "";

  return (
    <button
      onClick={onSelect}
      style={{ height }}
      className={`flex w-full items-center border-b border-border px-0 text-left font-mono text-body ${tint} ${
        selected ? "" : "hover:bg-muted"
      }`}
    >
      <span className={`${W.seq} shrink-0 px-3 text-muted-foreground`}>{row.seq}</span>
      <span className={`flex ${W.severity} shrink-0 items-center gap-1.5 px-3`}>
        {sev ? (
          <>
            <span className={`${sev.dot} inline-block h-2 w-2 shrink-0 rounded-full`} />
            <span className={sev.text}>{SEV_CELL[severity!].label}</span>
          </>
        ) : (
          <span className="text-muted-foreground" title="no finding for this capture">
            —
          </span>
        )}
      </span>
      {/* max-p baseline (F4): the number keeps the single-line box every sibling cell uses, so it
          shares the row baseline; the bar paints below it, pinned to the cell, never displacing it */}
      <span className={`relative flex ${W.maxProb} shrink-0 items-center px-3`}>
        <span className="text-foreground">
          {row.maxProb !== null ? row.maxProb.toFixed(2) : "—"}
        </span>
        {row.maxProb !== null && (
          <span className="absolute inset-x-3 bottom-0.5 block h-0.5 bg-muted">
            {/* p-space shape, neutral fill: the bar shows WHERE the value sits, never what it means */}
            <span
              className="block h-0.5 bg-foreground/40"
              style={{ width: `${row.maxProb * 100}%` }}
            />
          </span>
        )}
      </span>
      <span className={`${W.rule} shrink-0 px-3 text-muted-foreground`}>
        {row.questionCount > 0 ? row.questionCount : "—"}
      </span>
      <span className="min-w-0 flex-1 truncate px-3 text-foreground" title={row.path ?? undefined}>
        {row.path ?? <span className="text-muted-foreground">no path</span>}
      </span>
    </button>
  );
});
