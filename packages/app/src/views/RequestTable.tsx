import { useEffect, useMemo, useRef, useState } from "react";
import { SEVERITY } from "./color";
import { DensityStrip, MiniStrip, marksFor } from "./DensityStrip";
import { Row } from "./Row";
import { sevRank, useRun, type Filter, type Mode } from "./useRun";
import type { Cell } from "../types";
import { Button } from "@/components/ui/button";

interface Props {
  runId: string;
  mode: Mode;
  onMode: (m: Mode) => void;
  /** Rule the report panel wants surfaced: switch to rule mode, expand + scroll to it once. */
  focusRule: string | null;
  onFocusHandled: () => void;
  selectedFile: string | null;
  onSelectPair: (pair: { rule: string; input: string; requestFile?: string }) => void;
}

/**
 * The renderable span label ("L4", "L4-L10") — the display half of identity-vs-label: the uuid in
 * the input stays the key, the span is what the user reads.
 */
export function spanLabel(span: { start: { line: number }; end: { line: number } }): string {
  return span.start.line === span.end.line
    ? "L" + span.start.line
    : "L" + span.start.line + "-L" + span.end.line;
}

const ROW_H = 26;
const OVERSCAN = 12;
// sticky column-header row inside the scroll container
const HEADER_H = 27;
// Fixed columns total ~570px; below that the path column would collapse to an ellipsis, so the
// header + rows scroll horizontally together instead.
const TABLE_MIN_W = 660;

// request-mode columns (the capture log); grouped modes have their own grids below
type ReqKey = "seq" | "rule" | "severity" | "maxProb";
const REQ_COLS: { key: ReqKey; label: string; className: string }[] = [
  { key: "seq", label: "seq", className: "w-14" },
  { key: "rule", label: "rule", className: "w-52" },
  { key: "severity", label: "severity", className: "w-24" },
  { key: "maxProb", label: "max-p", className: "w-20" },
  // question count; sorts with rule (data, not signal)
  { key: "rule", label: "q", className: "w-10" },
];

// grouped-mode shared grid: name | input | sev | value | counts | chevron
const NAME_W = "w-52";
const INPUT_MIN = "min-w-0 flex-1";
const SEV_W = "w-16";
const VALUE_W = "w-16";
const COUNT_W = "w-24";
const CHEV_W = "w-6";

type GroupedKey = "name" | "input" | "severity" | "value";
const GROUPED_COLS: {
  key: GroupedKey | "counts" | "chev";
  label: string;
  className: string;
  sortable: boolean;
}[] = [
  { key: "name", label: "rule / file", className: NAME_W, sortable: true },
  { key: "input", label: "input", className: INPUT_MIN, sortable: true },
  { key: "severity", label: "sev", className: SEV_W, sortable: true },
  { key: "value", label: "value", className: VALUE_W, sortable: true },
  { key: "counts", label: "", className: COUNT_W, sortable: false },
  { key: "chev", label: "", className: CHEV_W, sortable: false },
];

const byName = (a: string, b: string) => a.localeCompare(b);

export function RequestTable({
  runId,
  mode,
  onMode,
  focusRule,
  onFocusHandled,
  selectedFile,
  onSelectPair,
}: Props) {
  const {
    query,
    rows,
    ruleGroups,
    fileGroups,
    filter,
    setFilter,
    sortKey,
    sortDir,
    toggleSort,
    setSort,
  } = useRun(runId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  // grouped modes default to error-first: sev desc is the initial toggle state, not a fixed order
  useEffect(() => {
    if (mode !== "request" && !(sortKey === "severity" && sortDir === "desc")) {
      const groupedKeys = ["name", "input", "severity", "value"];
      if (!groupedKeys.includes(sortKey)) setSort("severity", "desc");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const onFilter = (patch: Partial<Filter>) => {
    setFilter({ ...filter, ...patch });
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // --- grouped render model: flat [parent, ...children] rows, one sort key for both levels ---
  const grouped = useMemo(() => {
    const dir = sortDir === "desc" ? -1 : 1;
    const dirKey = sortKey as GroupedKey;
    const cellCmp = (a: Cell, b: Cell): number => {
      switch (dirKey) {
        case "name":
          return dir * byName(a.rule, b.rule);
        case "input":
          return dir * byName(a.input, b.input);
        case "severity":
          return dir * (sevRank(a.severity) - sevRank(b.severity)) || byName(a.input, b.input);
        case "value":
          return dir * (a.value - b.value || byName(a.rule, b.rule));
        default:
          return 0;
      }
    };
    const sortCells = (cs: Cell[]) => [...cs].sort(cellCmp);

    interface ParentRow {
      kind: "parent";
      key: string;
      name: string;
      sev: "error" | "warn" | null;
      cells: Cell[];
      counts: string;
    }
    interface ChildRow {
      kind: "child";
      key: string;
      parentKey: string;
      cell: Cell;
    }
    type Row = ParentRow | ChildRow;

    const build = (
      groups: { key: string; name: string; cells: Cell[] }[],
    ): { list: Row[]; parents: ParentRow[] } => {
      const parents: ParentRow[] = groups.map((g) => {
        const worst = g.cells.reduce<"error" | "warn" | null>(
          (acc, c) => (sevRank(c.severity) > sevRank(acc) ? c.severity : acc),
          null,
        );
        return { kind: "parent", key: g.key, name: g.name, sev: worst, cells: g.cells, counts: "" };
      });
      // one comparator per column; a column a parent does not expose leaves it in group order
      const parentCmp = (a: ParentRow, b: ParentRow): number => {
        switch (dirKey) {
          case "name":
            return dir * byName(a.name, b.name);
          case "input":
            return dir * byName(a.cells[0]?.input ?? "", b.cells[0]?.input ?? "");
          case "severity":
            return dir * (sevRank(a.sev) - sevRank(b.sev)) || byName(a.name, b.name);
          case "value":
            // parents expose no single value; stable order
            return 0;
          default:
            return 0;
        }
      };
      const sorted = [...parents].sort(parentCmp);
      const list: Row[] = [];
      for (const parent of sorted) {
        list.push(parent);
        if (expanded.has(parent.key)) {
          // child key: NUL-joined (rule, input) - both halves can contain any other character
          for (const c of sortCells(parent.cells)) {
            list.push({
              kind: "child",
              key: parent.key + "\u0000" + c.rule + "\u0000" + c.input,
              parentKey: parent.key,
              cell: c,
            });
          }
        }
      }
      return { list, parents: sorted };
    };

    if (mode === "rule") {
      const { list, parents } = build(
        ruleGroups.map((g) => ({ key: "rule:" + g.rule, name: g.rule, cells: g.cells })),
      );
      return { list, parents };
    }
    if (mode === "file") {
      const { list, parents } = build(
        fileGroups.map((g) => ({ key: "file:" + g.file, name: g.file, cells: g.cells })),
      );
      return { list, parents };
    }
    return { list: [], parents: [] };
  }, [mode, ruleGroups, fileGroups, expanded, sortKey, sortDir]);

  // report click: switch to rule mode, expand the rule's group, scroll it into view (once)
  useEffect(() => {
    if (focusRule === null || mode !== "rule") return;
    const key = "rule:" + focusRule;
    setExpanded((prev) => new Set(prev).add(key));
    const idx = grouped.parents.findIndex((p) => p.key === key);
    if (idx >= 0) scrollRef.current?.scrollTo({ top: idx * ROW_H });
    onFocusHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRule, mode]);

  const range = useMemo(() => {
    // scrollTop includes the sticky header row; compensate before mapping to row indexes
    const scrollRows = Math.max(0, scrollTop - HEADER_H);
    const first = Math.max(0, Math.floor(scrollRows / ROW_H) - OVERSCAN);
    const visible = Math.ceil(viewportH / ROW_H) + OVERSCAN * 2;
    const total = mode === "request" ? rows.length : grouped.list.length;
    return { first, last: Math.min(total, first + visible) };
  }, [scrollTop, viewportH, rows.length, grouped, mode]);

  const activeFilters = [filter.text && `text "${filter.text}"`].filter(Boolean);
  const total =
    mode === "request"
      ? (query.data?.requestCount ?? 0)
      : mode === "rule"
        ? ruleGroups.length
        : fileGroups.length;
  const noun = mode === "request" ? "requests" : mode === "rule" ? "rules" : "files";

  const modeButton = (m: Mode, label: string) => (
    <Button
      variant={mode === m ? "secondary" : "outline"}
      size="sm"
      onClick={() => onMode(m)}
      aria-pressed={mode === m}
      data-testid={`mode-${m}`}
      className="font-mono text-xs"
    >
      {label}
    </Button>
  );

  const groupedHeader = (
    <div
      className="sticky top-0 z-10 flex border-b border-border bg-muted font-mono text-xs text-foreground"
      style={{ minWidth: TABLE_MIN_W }}
    >
      {GROUPED_COLS.map((c) => (
        <button
          key={c.key}
          disabled={!c.sortable}
          onClick={() => c.sortable && toggleSort(c.key as GroupedKey)}
          className={`${c.className} shrink-0 px-2 py-1 text-left ${c.sortable ? "hover:text-foreground" : ""}`}
        >
          {c.label}
          {c.sortable && sortKey === c.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
        </button>
      ))}
    </div>
  );

  const requestHeader = (
    <div
      className="sticky top-0 z-10 flex border-b border-border bg-muted font-mono text-xs text-foreground"
      style={{ minWidth: TABLE_MIN_W }}
    >
      {REQ_COLS.map((c) => (
        <button
          key={c.label}
          onClick={() => toggleSort(c.key)}
          className={`${c.className} shrink-0 px-2 py-1 text-left hover:text-foreground`}
        >
          {c.label}
          {sortKey === c.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
        </button>
      ))}
      <span className="min-w-0 flex-1 px-2 py-1">input path</span>
    </div>
  );

  const sevDot = (sev: "error" | "warn" | null) =>
    sev === null ? (
      <span className="text-muted-foreground" title="no verdict">
        —
      </span>
    ) : (
      <span className={`inline-block h-2 w-2 rounded-full ${SEVERITY[sev].dot}`} title={sev} />
    );

  const renderGroupedRow = (row: (typeof grouped.list)[number]) => {
    if (row.kind === "parent") {
      const stats =
        mode === "rule"
          ? ruleGroups.find((g) => "rule:" + g.rule === row.key)!.stats
          : fileGroups.find((g) => "file:" + g.file === row.key)!.stats;
      const countText =
        "targets" in stats ? stats.targets + " targets" : stats.rules + " rules · " + stats.cells;
      const isExpanded = expanded.has(row.key);
      return (
        <button
          key={row.key}
          onClick={() => toggleExpand(row.key)}
          aria-expanded={isExpanded}
          style={{ height: ROW_H }}
          className="flex w-full items-center border-b border-border bg-muted px-0 text-left font-mono text-xs text-foreground hover:bg-accent"
        >
          <span className={`${NAME_W} shrink-0 truncate px-2`} title={row.name}>
            {isExpanded ? "▾" : "▸"} {row.name}
          </span>
          <span className={`${INPUT_MIN} flex shrink-0 items-center gap-2 px-2`}>
            <MiniStrip
              values={row.cells.map((c) => c.value)}
              marks={marksFor(query.data?.handles[row.name])}
            />
            <span className="text-muted-foreground">
              {stats.err > 0 && <span className="text-sev-error">{stats.err} err</span>}
              {stats.err > 0 && stats.warn > 0 && " · "}
              {stats.warn > 0 && <span className="text-sev-warn">{stats.warn} warn</span>}
              {stats.err === 0 && stats.warn === 0 && `${stats.passOk} no verdict`}
            </span>
          </span>
          <span className={`${SEV_W} shrink-0 px-2`}>{sevDot(row.sev)}</span>
          <span className={`${VALUE_W} shrink-0 px-2 text-muted-foreground`}></span>
          <span className={`${COUNT_W} shrink-0 px-2 text-muted-foreground`}>{countText}</span>
          <span className={`${CHEV_W} shrink-0 px-2`}></span>
        </button>
      );
    }
    const c = row.cell;
    return (
      <button
        key={row.key}
        onClick={() => onSelectPair({ rule: c.rule, input: c.input, requestFile: c.requestFile })}
        style={{ height: ROW_H }}
        className={`flex w-full items-center border-b border-border pl-4 pr-0 text-left font-mono text-xs ${
          selectedFile === c.file ? "bg-accent text-accent-foreground" : "hover:bg-muted"
        } text-foreground`}
      >
        <span className={`${NAME_W} shrink-0 truncate px-2`} title={c.rule}>
          {c.rule}
        </span>
        <span className={`${INPUT_MIN} shrink-0 truncate px-2`} title={c.input}>
          {c.element === undefined || c.element.kind === "file"
            ? "(file)"
            : spanLabel(c.element.span)}
        </span>
        <span className={`${SEV_W} shrink-0 px-2`}>{sevDot(c.severity)}</span>
        <span className={`${VALUE_W} shrink-0 px-2`}>{c.value.toFixed(2)}</span>
        <span className={`${COUNT_W} shrink-0 px-2`}></span>
        <span className={`${CHEV_W} shrink-0 px-2`}></span>
      </button>
    );
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-muted px-2 py-1.5">
        <div role="group" aria-label="group by" className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-muted-foreground">group by</span>
          {modeButton("request", "request")}
          {modeButton("rule", "rule")}
          {modeButton("file", "file")}
        </div>
        <input
          value={filter.text}
          onChange={(e) => onFilter({ text: e.target.value })}
          placeholder="filter: path, rule, element id…"
          className="w-64 rounded border border-neutral-700 bg-background px-2 py-1 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-neutral-500"
        />
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {query.isLoading
            ? "loading…"
            : `${mode === "request" ? rows.length : grouped.list.length} / ${total} ${noun}`}
        </span>
      </div>
      {mode === "request" && !query.isLoading && rows.length > 0 && <DensityStrip rows={rows} />}
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-auto"
      >
        {query.isError && <p className="p-3 text-sev-error">{String(query.error)}</p>}
        {!query.isLoading &&
          (mode === "request" ? rows.length : grouped.list.length) === 0 &&
          !query.isError && (
            <div className="flex h-32 flex-col items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
              <p>0 {noun} match your filters</p>
              {mode !== "request" && query.data?.cells.length === 0 && (
                <p className="text-muted-foreground">no measurements captured for this run</p>
              )}
              {activeFilters.length > 0 && (
                <p className="text-muted-foreground">active: {activeFilters.join(", ")}</p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="font-mono text-xs"
                onClick={() => setFilter({ text: "" })}
              >
                clear filters
              </Button>
            </div>
          )}
        {mode === "request" ? requestHeader : groupedHeader}
        <div
          style={{
            height: (mode === "request" ? rows.length : grouped.list.length) * ROW_H,
            position: "relative",
            minWidth: TABLE_MIN_W,
          }}
        >
          <div style={{ transform: `translateY(${range.first * ROW_H}px)` }}>
            {mode === "request"
              ? rows.slice(range.first, range.last).map((r) => (
                  <Row
                    key={r.file}
                    row={r}
                    height={ROW_H}
                    selected={r.file === selectedFile}
                    severity={r.severity}
                    onSelect={() =>
                      onSelectPair({
                        rule: r.rules[0] ?? "",
                        input:
                          r.path !== null && r.elementId !== null && r.element
                            ? `${r.path}#${r.elementId}`
                            : (r.path ?? r.file),
                        requestFile: r.file,
                      })
                    }
                  />
                ))
              : grouped.list.slice(range.first, range.last).map((row) => renderGroupedRow(row))}
          </div>
        </div>
      </div>
    </section>
  );
}
