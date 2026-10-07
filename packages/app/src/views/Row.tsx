import { memo } from "react";
import { ROW_CURSOR, ROW_HOVER } from "../lib/row";
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
      /* top-px on the cells: +1px optical drop. ui-monospace's font box is ~10 asc / 4 desc and
         vertical centering balances that box, so descender-less mono glyphs read ~1.5px high;
         padding cannot move a middle-aligned cell, but a relative offset can (measured
         8/11 -> 9/10 on the glyph gaps). Shared by every cell so the row keeps one baseline. */
      className={`${ROW_CURSOR} border-b border-border font-mono text-body ${tint} ${
        selected ? "" : ROW_HOVER
      }`}
    >
      <td className="relative top-px px-rail text-muted-foreground">{row.seq}</td>
      <td className="relative top-px px-rail">
        {sev ? (
          <span className="flex items-center gap-chip-x">
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
      <td className="relative top-px px-rail">
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
      <td className="relative top-px px-rail text-muted-foreground">
        {row.questionCount > 0 ? row.questionCount : "—"}
      </td>
      <td
        className="relative top-px min-w-0 truncate px-rail text-foreground"
        title={row.path ?? undefined}
      >
        {row.path ?? <span className="text-muted-foreground">no path</span>}
      </td>
    </tr>
  );
});
