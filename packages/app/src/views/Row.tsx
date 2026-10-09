import { memo } from "react";
import { ROW_CURSOR, ROW_HOVER } from "../lib/row";
import { SEVERITY } from "./color";
import type { RequestItem } from "../types";

const SEV_CELL = { error: { label: "error" }, warn: { label: "warn" } } as const;

/** One request wire duration: 985ms / 2.1s; em dash when unknown. */
export const requestDuration = (ms: number | null): string =>
  ms === null
    ? "—"
    : ms < 1000
      ? `${ms}ms`
      : ms < 60_000
        ? `${Math.round(ms / 100) / 10}s`
        : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;

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
      data-testid={`request-${row.path ?? row.file}`}
      data-element={row.elementId ?? undefined}
      style={{ height }}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`${ROW_CURSOR} border-b border-border text-body ${tint} ${
        selected ? "" : ROW_HOVER
      }`}
    >
      <td className="px-rail text-muted-foreground">{row.seq}</td>
      <td className="px-rail">
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
      <td className="relative px-rail">
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
      <td className="px-rail text-muted-foreground">
        {row.questionCount > 0 ? row.questionCount : "—"}
      </td>
      <td className="px-rail text-muted-foreground">{requestDuration(row.durationMs)}</td>
      <td className="min-w-0 truncate px-rail text-foreground" title={row.path ?? undefined}>
        {row.path ?? <span className="text-muted-foreground">no path</span>}
      </td>
    </tr>
  );
});
