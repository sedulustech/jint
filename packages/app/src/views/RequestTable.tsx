import { useEffect, useMemo, useRef, useState } from "react";
import { DensityStrip, marksFor } from "./DensityStrip";
import { Row } from "./Row";
import { useRun, type Filter } from "./useRun";
import type { RequestSummary } from "../types";
import { Button } from "@/components/ui/button";

interface Props {
  runId: string;
  ruleFilter: string | null;
  onClearRule: () => void;
  selectedFile: string | null;
  onSelect: (r: RequestSummary) => void;
}

const ROW_H = 26;
const OVERSCAN = 12;
// sticky column-header row inside the scroll container
const HEADER_H = 27;
// Fixed columns total ~570px; below that the path column would collapse to an ellipsis, so the
// header + rows scroll horizontally together instead.
const TABLE_MIN_W = 660;

const COLS: {
  key: "borderline" | "seq" | "rule" | "severity" | "maxProb";
  label: string;
  className: string;
}[] = [
  { key: "seq", label: "seq", className: "w-14" },
  { key: "rule", label: "rule", className: "w-52" },
  { key: "severity", label: "severity", className: "w-24" },
  { key: "maxProb", label: "max-p", className: "w-20" },
  // question count; sorts with rule (data, not signal)
  { key: "rule", label: "q", className: "w-10" },
];

export function RequestTable({ runId, ruleFilter, onClearRule, selectedFile, onSelect }: Props) {
  const { query, rows, filter, setFilter, sortKey, sortDir, toggleSort, severityOf } = useRun(
    runId,
    ruleFilter,
  );
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const range = useMemo(() => {
    // scrollTop includes the sticky header row; compensate before mapping to row indexes
    const scrollRows = Math.max(0, scrollTop - HEADER_H);
    const first = Math.max(0, Math.floor(scrollRows / ROW_H) - OVERSCAN);
    const visible = Math.ceil(viewportH / ROW_H) + OVERSCAN * 2;
    return { first, last: Math.min(rows.length, first + visible) };
  }, [scrollTop, viewportH, rows.length]);

  const onFilter = (patch: Partial<Filter>) => {
    setFilter({ ...filter, ...patch });
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const activeFilters = [
    filter.text && `text "${filter.text}"`,
    filter.band && "borderline band",
  ].filter(Boolean);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-2 py-1.5">
        <input
          value={filter.text}
          onChange={(e) => onFilter({ text: e.target.value })}
          placeholder="filter: path, rule, element id…"
          className="w-64 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-200 outline-none placeholder:text-neutral-500 focus:border-neutral-500"
        />
        {ruleFilter !== null && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onClearRule}
            className="border-fuchsia-400 font-mono text-xs text-fuchsia-200"
          >
            rule: {ruleFilter} ✕
          </Button>
        )}
        <Button
          variant={filter.band === "borderline" ? "secondary" : "outline"}
          size="sm"
          onClick={() => onFilter({ band: filter.band === "borderline" ? "" : "borderline" })}
          title="only captures with an answer within 0.3 of 0.5"
          className={
            "font-mono text-xs " +
            (filter.band === "borderline"
              ? "border-fuchsia-400 text-fuchsia-200"
              : "text-neutral-400")
          }
        >
          borderline
        </Button>
        <span className="ml-auto font-mono text-xs text-neutral-400">
          {query.isLoading
            ? "loading…"
            : `${rows.length} / ${query.data?.requestCount ?? "?"} requests`}
        </span>
      </div>
      {!query.isLoading && rows.length > 0 && (
        <DensityStrip
          rows={rows}
          marks={ruleFilter !== null ? marksFor(query.data?.handles[ruleFilter]) : []}
        />
      )}
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-auto"
      >
        {query.isError && <p className="p-3 text-red-400">{String(query.error)}</p>}
        {!query.isLoading && rows.length === 0 && !query.isError && (
          <div className="flex h-32 flex-col items-center justify-center gap-2 font-mono text-xs text-neutral-400">
            <p>0 requests match your filters</p>
            {activeFilters.length > 0 && (
              <p className="text-neutral-500">active: {activeFilters.join(", ")}</p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="font-mono text-xs"
              onClick={() => setFilter({ text: "", band: "" })}
            >
              clear filters
            </Button>
          </div>
        )}
        <div
          className="sticky top-0 z-10 flex border-b border-neutral-800 bg-neutral-900 font-mono text-xs text-neutral-300"
          style={{ minWidth: TABLE_MIN_W }}
        >
          {COLS.map((c) => (
            <button
              key={c.label}
              onClick={() => toggleSort(c.key)}
              className={`${c.className} shrink-0 px-2 py-1 text-left hover:text-white`}
            >
              {c.label}
              {sortKey === c.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
            </button>
          ))}
          <button
            onClick={() => toggleSort("borderline")}
            className="w-28 shrink-0 px-2 py-1 text-left hover:text-white"
            title="distance of the strongest answer from 0.5"
          >
            borderline{sortKey === "borderline" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
          </button>
          <span className="min-w-0 flex-1 px-2 py-1">input path</span>
        </div>
        <div style={{ height: rows.length * ROW_H, position: "relative", minWidth: TABLE_MIN_W }}>
          <div style={{ transform: `translateY(${range.first * ROW_H}px)` }}>
            {rows.slice(range.first, range.last).map((r) => (
              <Row
                key={r.file}
                row={r}
                height={ROW_H}
                selected={r.file === selectedFile}
                severity={severityOf(r)}
                onSelect={() => onSelect(r)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
