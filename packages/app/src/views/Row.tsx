import { memo } from "react";
import { SEVERITY } from "./color";
import type { RequestSummary } from "../types";

const SEV_CELL = {
  error: { dot: "bg-red-500", text: "text-red-400", label: "error" },
  warn: { dot: "bg-amber-400", text: "text-amber-300", label: "warn" },
} as const;

interface Props {
  row: RequestSummary;
  height: number;
  selected: boolean;
  severity: "error" | "warn" | null;
  onSelect: () => void;
}

export const Row = memo(function Row({ row, height, selected, severity, onSelect }: Props) {
  const sev = severity !== null ? SEVERITY[severity] : null;
  const tint = selected ? "bg-neutral-700 text-white" : sev ? sev.row : "";

  return (
    <button
      onClick={onSelect}
      style={{ height }}
      className={`flex w-full items-center border-b border-neutral-900 px-0 text-left font-mono text-xs ${tint} ${
        selected ? "" : "hover:bg-neutral-800/60"
      }`}
    >
      <span className="w-14 shrink-0 px-2 text-neutral-400">{row.seq}</span>
      <span className="w-52 shrink-0 truncate px-2 text-neutral-200" title={row.rules.join(", ")}>
        {row.rules[0] ?? "—"}
      </span>
      <span className="flex w-24 shrink-0 items-center gap-1.5 px-2">
        {sev ? (
          <>
            <span className={`${sev.dot} inline-block h-2 w-2 shrink-0 rounded-full`} />
            <span className={sev.text}>{SEV_CELL[severity!].label}</span>
          </>
        ) : (
          <span className="text-neutral-500">—</span>
        )}
      </span>
      <span className="flex w-20 shrink-0 flex-col justify-center px-2">
        <span className="text-neutral-300">
          {row.maxProb !== null ? row.maxProb.toFixed(2) : "—"}
        </span>
        {row.maxProb !== null && (
          <span className="mt-0.5 block h-0.5 w-full bg-neutral-800">
            {/* p-space shape, neutral fill: the bar shows WHERE the value sits, never what it means */}
            <span
              className="block h-0.5 bg-neutral-500"
              style={{ width: `${row.maxProb * 100}%` }}
            />
          </span>
        )}
      </span>
      <span className="w-10 shrink-0 px-2 text-neutral-400">
        {row.questionCount > 0 ? row.questionCount : "—"}
      </span>
      <span className="min-w-0 flex-1 truncate px-2 text-neutral-200" title={row.path ?? undefined}>
        {row.path ?? <span className="text-neutral-500">no path</span>}
      </span>
    </button>
  );
});
