import { memo } from "react";
import { SEVERITY } from "./color";
import type { RequestItem } from "../types";

const SEV_CELL = { error: { label: "error" }, warn: { label: "warn" } } as const;

interface Props {
  row: RequestItem;
  height: number;
  selected: boolean;
  severity: "error" | "warn" | null;
  onSelect: () => void;
}

/**
 * One request-log row as a real table row. Column widths come from the thead (table-fixed on the
 * <table>), so the cells here carry no width classes - the alignment that used to live in
 * duplicated literals is the layout engine's job.
 */
export const Row = memo(function Row({ row, height, selected, severity, onSelect }: Props) {
  const sev = severity !== null ? SEVERITY[severity] : null;
  const tint = selected ? "bg-accent text-accent-foreground" : sev ? sev.row : "";

  return (
    <tr
      onClick={onSelect}
      style={{ height }}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer border-b border-border font-mono text-body ${tint} ${
        selected ? "" : "hover:bg-muted"
      }`}
    >
      <td className="px-3 text-muted-foreground">{row.seq}</td>
      <td className="px-3">
        {sev ? (
          <span className="flex items-center gap-1.5">
            <span className={`${sev.dot} inline-block h-2 w-2 shrink-0 rounded-full`} />
            <span className={sev.text}>{SEV_CELL[severity!].label}</span>
          </span>
        ) : (
          <span className="text-muted-foreground" title="no finding for this request">
            —
          </span>
        )}
      </td>
      {/* max-p baseline (F4): the number keeps the single-line box every sibling cell uses, so it
          shares the row baseline; the bar paints below it, pinned to the cell, never displacing it */}
      <td className="relative px-3">
        <span className="text-foreground">
          {row.maxProb !== null ? row.maxProb.toFixed(2) : "—"}
        </span>
        {row.maxProb !== null && (
          <span className="absolute inset-x-3 bottom-0.5 block h-0.5 bg-muted">
            <span
              className="block h-0.5 bg-foreground/40"
              style={{ width: `${row.maxProb * 100}%` }}
            />
          </span>
        )}
      </td>
      <td className="px-3 text-muted-foreground">
        {row.questionCount > 0 ? row.questionCount : "—"}
      </td>
      <td className="min-w-0 truncate px-3 text-foreground" title={row.path ?? undefined}>
        {row.path ?? <span className="text-muted-foreground">no path</span>}
      </td>
    </tr>
  );
});
