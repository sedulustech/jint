import { memo } from "react";
import { SEVERITY } from "./color";
import type { RequestSummary } from "../types";

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
      className={`flex w-full items-center border-b border-border px-0 text-left font-mono text-xs ${tint} ${
        selected ? "" : "hover:bg-muted"
      }`}
    >
      <span className="w-14 shrink-0 px-2 text-muted-foreground">{row.seq}</span>
      <span className="w-52 shrink-0 truncate px-2 text-foreground" title={row.rules.join(", ")}>
        {row.rules[0] ?? "—"}
      </span>
      <span className="flex w-24 shrink-0 items-center gap-1.5 px-2">
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
      <span className="flex w-20 shrink-0 flex-col justify-center px-2">
        <span className="text-foreground">
          {row.maxProb !== null ? row.maxProb.toFixed(2) : "—"}
        </span>
        {row.maxProb !== null && (
          <span className="mt-0.5 block h-0.5 w-full bg-muted">
            {/* p-space shape, neutral fill: the bar shows WHERE the value sits, never what it means */}
            <span
              className="block h-0.5 bg-foreground/40"
              style={{ width: `${row.maxProb * 100}%` }}
            />
          </span>
        )}
      </span>
      <span className="w-10 shrink-0 px-2 text-muted-foreground">
        {row.questionCount > 0 ? row.questionCount : "—"}
      </span>
      <span className="min-w-0 flex-1 truncate px-2 text-foreground" title={row.path ?? undefined}>
        {row.path ?? <span className="text-muted-foreground">no path</span>}
      </span>
    </button>
  );
});
