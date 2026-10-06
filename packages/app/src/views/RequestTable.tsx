import { useEffect, useMemo, useRef, useState } from "react";
import { SEVERITY } from "./color";
import { DensityStrip } from "./DensityStrip";
import { REQUEST_COLUMNS } from "./requestCols";
import { Row } from "./Row";
import {
  sevRank,
  useRun,
  type FileGroup,
  type Filter,
  type GroupStats,
  type Mode,
  type RuleGroup,
  type SortKey,
} from "./useRun";
import type { Cell, RequestItem } from "../types";
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

const ROW_HEIGHT = 26;
const OVERSCAN = 12;
// header + rows scroll horizontally together below this width: fixed columns would otherwise
// collapse the path column to an ellipsis
const HEADER_HEIGHT = 27;
const TABLE_MIN_WIDTH = 660;

// grouped-mode shared grid: name | input | severity | value | counts | chevron
const NAME_WIDTH = "w-52";
const INPUT_MIN_WIDTH = "min-w-0 flex-1";
const SEVERITY_WIDTH = "w-16";
const VALUE_WIDTH = "w-16";
const COUNTS_WIDTH = "w-24";
const CHEVRON_WIDTH = "w-6";

type GroupedKey = "name" | "input" | "severity" | "value";
const GROUPED_COLS: {
  key: GroupedKey | "counts" | "chevron";
  label: string;
  className: string;
  sortable: boolean;
}[] = [
  { key: "name", label: "rule / file", className: NAME_WIDTH, sortable: true },
  { key: "input", label: "input", className: INPUT_MIN_WIDTH, sortable: true },
  { key: "severity", label: "sev", className: SEVERITY_WIDTH, sortable: true },
  { key: "value", label: "value", className: VALUE_WIDTH, sortable: true },
  { key: "counts", label: "", className: COUNTS_WIDTH, sortable: false },
  { key: "chevron", label: "", className: CHEVRON_WIDTH, sortable: false },
];

const compareText = (left: string, right: string) => left.localeCompare(right);

const ruleGroupKey = (rule: string): string => "rule:" + rule;
const fileGroupKey = (file: string): string => "file:" + file;

interface ParentRow {
  kind: "parent";
  key: string;
  name: string;
  worstSeverity: "error" | "warn" | null;
  cells: Cell[];
  counts: string;
}
interface ChildRow {
  kind: "child";
  key: string;
  parentKey: string;
  cell: Cell;
}
type GroupedRow = ParentRow | ChildRow;

function parentComparator(
  sortDirection: number,
  sortColumn: GroupedKey,
): (left: ParentRow, right: ParentRow) => number {
  // a parent exposes no single value; unexposed columns keep group order
  return (left, right) => {
    switch (sortColumn) {
      case "name":
        return sortDirection * compareText(left.name, right.name);
      case "input":
        return sortDirection * compareText(left.cells[0]?.input ?? "", right.cells[0]?.input ?? "");
      case "severity":
        return (
          sortDirection * (sevRank(left.worstSeverity) - sevRank(right.worstSeverity)) ||
          compareText(left.name, right.name)
        );
      default:
        return 0;
    }
  };
}

function cellComparator(
  sortDirection: number,
  sortColumn: GroupedKey,
): (left: Cell, right: Cell) => number {
  return (left, right) => {
    switch (sortColumn) {
      case "name":
        return sortDirection * compareText(left.rule, right.rule);
      case "input":
        return sortDirection * compareText(left.input, right.input);
      case "severity":
        return (
          sortDirection * (sevRank(left.severity) - sevRank(right.severity)) ||
          compareText(left.input, right.input)
        );
      case "value":
        return sortDirection * (left.value - right.value || compareText(left.rule, right.rule));
      default:
        return 0;
    }
  };
}

/**
 * Grouped render model: flat [parent, ...children] rows, one sort key for both levels. Parents sort
 * by column, children sort within their group by the same column. A child key is the parent key
 * NUL-joined with rule and input; NUL never occurs in a rule or input name, so the join can never
 * collide with a guest half.
 */
function buildGroupedRows(
  groupSpecs: { key: string; name: string; cells: Cell[] }[],
  sortDirection: number,
  sortColumn: GroupedKey,
  expandedKeys: Set<string>,
): { flatRows: GroupedRow[]; parentRows: ParentRow[] } {
  const parentRows: ParentRow[] = groupSpecs.map((groupSpec) => {
    const worstSeverity = groupSpec.cells.reduce<"error" | "warn" | null>(
      (acc, cell) => (sevRank(cell.severity) > sevRank(acc) ? cell.severity : acc),
      null,
    );
    return {
      kind: "parent",
      key: groupSpec.key,
      name: groupSpec.name,
      worstSeverity,
      cells: groupSpec.cells,
      counts: "",
    };
  });
  const sortedParentRows = [...parentRows].sort(parentComparator(sortDirection, sortColumn));
  const compareChildren = cellComparator(sortDirection, sortColumn);
  const flatRows: GroupedRow[] = [];
  for (const parentRow of sortedParentRows) {
    flatRows.push(parentRow);
    if (expandedKeys.has(parentRow.key)) {
      for (const cell of [...parentRow.cells].sort(compareChildren)) {
        flatRows.push({
          kind: "child",
          key: parentRow.key + "\u0000" + cell.rule + "\u0000" + cell.input,
          parentKey: parentRow.key,
          cell,
        });
      }
    }
  }
  return { flatRows, parentRows: sortedParentRows };
}

/** The click payload for one request-log row: the measured subject, or the file when untargeted. */
function requestPair(requestRow: RequestItem): {
  rule: string;
  input: string;
  requestFile: string;
} {
  return {
    rule: requestRow.rules[0] ?? "",
    input:
      requestRow.path !== null && requestRow.elementId !== null && requestRow.element
        ? `${requestRow.path}#${requestRow.elementId}`
        : (requestRow.path ?? requestRow.file),
    requestFile: requestRow.file,
  };
}

function groupStatsFor(
  mode: Mode,
  ruleGroups: RuleGroup[],
  fileGroups: FileGroup[],
  row: ParentRow,
): GroupStats & { targets?: number; rules?: number; cells?: number } {
  return mode === "rule"
    ? ruleGroups.find((group) => ruleGroupKey(group.rule) === row.key)!.stats
    : fileGroups.find((group) => fileGroupKey(group.file) === row.key)!.stats;
}

type Pair = { rule: string; input: string; requestFile?: string };

/** Why the grouped table is empty when the report itself is missing or silent. */
function emptyStateNote(
  hasNoRows: boolean,
  mode: Mode,
  runData: { cells: Cell[]; legacy?: boolean; hasReport?: boolean } | undefined,
): string | null {
  if (!hasNoRows || mode === "request" || runData === undefined) return null;
  if (runData.cells.length !== 0) return null;
  if (runData.legacy) return "no report — run recorded before reports existed";
  if (runData.hasReport) return "report present but zero measurements";
  return "no report — run captured without --json";
}

function SeverityDot({ severity }: { severity: "error" | "warn" | null }) {
  if (severity === null) {
    return (
      <span className="text-muted-foreground" title="no verdict">
        —
      </span>
    );
  }
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${SEVERITY[severity].dot}`}
      title={severity}
    />
  );
}

function ModeButtons({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  const button = (buttonMode: Mode, label: string) => (
    <Button
      variant={mode === buttonMode ? "secondary" : "outline"}
      size="sm"
      onClick={() => onMode(buttonMode)}
      aria-pressed={mode === buttonMode}
      data-testid={`mode-${buttonMode}`}
      className="font-mono text-body"
    >
      {label}
    </Button>
  );
  return (
    <div role="group" aria-label="group by" className="flex items-center gap-related">
      <span className="font-mono text-caption text-muted-foreground">group by</span>
      {button("rule", "rule")}
      {button("file", "file")}
      {button("request", "request")}
    </div>
  );
}

function Toolbar({
  mode,
  onMode,
  filterText,
  onFilterText,
  countText,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  filterText: string;
  onFilterText: (text: string) => void;
  countText: string;
}) {
  return (
    <div className="flex items-center gap-siblings border-b border-border bg-muted px-rail py-bar-y">
      <ModeButtons mode={mode} onMode={onMode} />
      <input
        value={filterText}
        onChange={(e) => onFilterText(e.target.value)}
        placeholder="filter: path, rule, element id…"
        className="h-7 w-64 rounded-lg border border-input bg-background px-control-x font-mono text-body text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <span className="ml-auto font-mono text-body text-muted-foreground">{countText}</span>
    </div>
  );
}

function GroupedHeader({
  sortKey,
  sortDir,
  onToggleSort,
}: {
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onToggleSort: (key: SortKey) => void;
}) {
  return (
    <div
      className="sticky top-0 z-10 flex border-b border-border bg-muted font-mono text-body text-foreground"
      style={{ minWidth: TABLE_MIN_WIDTH }}
    >
      {GROUPED_COLS.map((col) => (
        <button
          key={col.key}
          disabled={!col.sortable}
          onClick={() => col.sortable && onToggleSort(col.key as GroupedKey)}
          className={`${col.className} shrink-0 px-rail py-cell-y text-left ${col.sortable ? "hover:text-foreground" : ""}`}
        >
          {col.label}
          {col.sortable && sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
        </button>
      ))}
    </div>
  );
}

function RequestHeader({
  sortKey,
  sortDir,
  onToggleSort,
}: {
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onToggleSort: (key: SortKey) => void;
}) {
  return (
    <thead className="sticky top-0 z-10 border-b border-border bg-muted font-mono text-body text-foreground">
      <tr>
        {REQUEST_COLUMNS.map((col) => (
          <th
            key={col.label}
            className={`${col.width} whitespace-nowrap px-rail py-cell-y text-left font-normal`}
          >
            <button
              onClick={() => onToggleSort(col.key)}
              className="w-full text-left hover:text-foreground"
            >
              {col.label}
              {sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
            </button>
          </th>
        ))}
        <th className="min-w-0 px-rail py-cell-y text-left font-normal">input path</th>
      </tr>
    </thead>
  );
}

function GroupedParentRow({
  row,
  stats,
  isExpanded,
  onToggleExpand,
}: {
  row: ParentRow;
  stats: GroupStats & { targets?: number; rules?: number; cells?: number };
  isExpanded: boolean;
  onToggleExpand: (key: string) => void;
}) {
  const countText =
    "targets" in stats ? stats.targets + " targets" : stats.rules + " rules · " + stats.cells;
  return (
    <button
      key={row.key}
      onClick={() => onToggleExpand(row.key)}
      aria-expanded={isExpanded}
      style={{ height: ROW_HEIGHT }}
      className="flex w-full items-center border-b border-border bg-muted text-left font-mono text-body text-foreground hover:bg-accent"
    >
      {/* parents share the column grid of header + children; hierarchy comes from the caret,
          never from shifting a column off the grid */}
      <span className={`${NAME_WIDTH} shrink-0 truncate px-rail`} title={row.name}>
        {isExpanded ? "▾" : "▸"} {row.name}
      </span>
      <span className={`${INPUT_MIN_WIDTH} flex shrink-0 items-center gap-siblings px-rail`}>
        <span className="text-muted-foreground">
          {stats.err > 0 && <span className="text-sev-error">{stats.err} err</span>}
          {stats.err > 0 && stats.warn > 0 && " · "}
          {stats.warn > 0 && <span className="text-sev-warn">{stats.warn} warn</span>}
          {stats.err === 0 && stats.warn === 0 && `${stats.passOk} no verdict`}
        </span>
      </span>
      <span className={`${SEVERITY_WIDTH} shrink-0 px-rail`}>
        <SeverityDot severity={row.worstSeverity} />
      </span>
      <span className={`${VALUE_WIDTH} shrink-0 px-rail text-muted-foreground`}></span>
      <span className={`${COUNTS_WIDTH} shrink-0 px-rail text-muted-foreground`}>{countText}</span>
      <span className={`${CHEVRON_WIDTH} shrink-0 px-rail`}></span>
    </button>
  );
}

function GroupedChildRow({
  row,
  mode,
  selectedFile,
  onSelectPair,
}: {
  row: ChildRow;
  mode: Mode;
  selectedFile: string | null;
  onSelectPair: (pair: Pair) => void;
}) {
  const cell = row.cell;
  // The child's identity axis follows the parent: in rule mode the parent is the rule, so the
  // child names the file it fired on; in file mode the reverse. Same grid either way.
  const childName = mode === "rule" ? cell.file : cell.rule;
  const childLocation =
    cell.element === undefined || cell.element.kind === "file"
      ? null
      : spanLabel(cell.element.span);
  return (
    <button
      key={row.key}
      onClick={() =>
        onSelectPair({ rule: cell.rule, input: cell.input, requestFile: cell.requestFile })
      }
      style={{ height: ROW_HEIGHT }}
      className={`flex w-full items-center border-b border-border text-left font-mono text-body ${
        selectedFile === cell.file ? "bg-accent text-accent-foreground" : "hover:bg-muted"
      } text-foreground`}
    >
      {/* pl-indent = rail 12 + 24px indent: children read as nested without leaving the grid */}
      <span className={`${NAME_WIDTH} shrink-0 truncate px-rail pl-indent`} title={childName}>
        {childName}
      </span>
      <span
        className={`${INPUT_MIN_WIDTH} shrink-0 truncate px-rail`}
        title={childLocation !== null ? `${cell.file}:${childLocation}` : cell.file}
      >
        {childLocation !== null ? childLocation : "(file)"}
      </span>
      <span className={`${SEVERITY_WIDTH} shrink-0 px-rail`}>
        <SeverityDot severity={cell.severity} />
      </span>
      <span className={`${VALUE_WIDTH} shrink-0 px-rail`}>{cell.value.toFixed(2)}</span>
      <span className={`${COUNTS_WIDTH} shrink-0 px-rail`}></span>
      <span className={`${CHEVRON_WIDTH} shrink-0 px-rail`}></span>
    </button>
  );
}

// Real table (not a virtualized flex grid): the <thead> owns the column widths via
// table-fixed, and every row derives alignment from it - the literal-sync drift class
// (header at w-16 while rows stayed w-10) cannot happen. The request log is at most a
// few hundred rows (~8k px), which the DOM renders fine without windowing; the windowed
// translateY machinery stays for the grouped tree mode only.
function RequestLog({
  rows,
  selectedFile,
  onSelectPair,
  sortKey,
  sortDir,
  onToggleSort,
}: {
  rows: RequestItem[];
  selectedFile: string | null;
  onSelectPair: (pair: Pair) => void;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onToggleSort: (key: SortKey) => void;
}) {
  return (
    <table className="w-full table-fixed font-mono text-body" style={{ minWidth: TABLE_MIN_WIDTH }}>
      <RequestHeader sortKey={sortKey} sortDir={sortDir} onToggleSort={onToggleSort} />
      <tbody>
        {rows.map((requestRow) => (
          <Row
            key={requestRow.file}
            row={requestRow}
            height={ROW_HEIGHT}
            selected={requestRow.file === selectedFile}
            severity={requestRow.severity}
            onSelect={() => onSelectPair(requestPair(requestRow))}
          />
        ))}
      </tbody>
    </table>
  );
}

function GroupedTreeView({
  list,
  range,
  mode,
  ruleGroups,
  fileGroups,
  expanded,
  onToggleExpand,
  selectedFile,
  onSelectPair,
  sortKey,
  sortDir,
  onToggleSort,
}: {
  list: GroupedRow[];
  range: { first: number; last: number };
  mode: Mode;
  ruleGroups: RuleGroup[];
  fileGroups: FileGroup[];
  expanded: Set<string>;
  onToggleExpand: (key: string) => void;
  selectedFile: string | null;
  onSelectPair: (pair: Pair) => void;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onToggleSort: (key: SortKey) => void;
}) {
  return (
    <>
      <GroupedHeader sortKey={sortKey} sortDir={sortDir} onToggleSort={onToggleSort} />
      <div
        style={{
          height: list.length * ROW_HEIGHT,
          position: "relative",
          minWidth: TABLE_MIN_WIDTH,
        }}
      >
        <div style={{ transform: `translateY(${range.first * ROW_HEIGHT}px)` }}>
          {list
            .slice(range.first, range.last)
            .map((row) =>
              row.kind === "parent" ? (
                <GroupedParentRow
                  key={row.key}
                  row={row}
                  stats={groupStatsFor(mode, ruleGroups, fileGroups, row)}
                  isExpanded={expanded.has(row.key)}
                  onToggleExpand={onToggleExpand}
                />
              ) : (
                <GroupedChildRow
                  key={row.key}
                  row={row}
                  mode={mode}
                  selectedFile={selectedFile}
                  onSelectPair={onSelectPair}
                />
              ),
            )}
        </div>
      </div>
    </>
  );
}

function EmptyNotice({
  countNoun,
  emptyDetail,
  activeText,
  onClearFilters,
}: {
  countNoun: string;
  emptyDetail: string | null;
  activeText: string | null;
  onClearFilters: () => void;
}) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-siblings font-mono text-body text-muted-foreground">
      <p>0 {countNoun} match your filters</p>
      {emptyDetail !== null && <p className="text-muted-foreground">{emptyDetail}</p>}
      {activeText !== null && <p className="text-muted-foreground">{activeText}</p>}
      <Button variant="outline" size="sm" className="font-mono text-body" onClick={onClearFilters}>
        clear filters
      </Button>
    </div>
  );
}

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
  const [viewportHeight, setViewportHeight] = useState(600);
  const scrollRef = useRef<HTMLDivElement>(null);

  const syncViewportHeight = () => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    const resizeObserver = new ResizeObserver(() => setViewportHeight(scrollElement.clientHeight));
    resizeObserver.observe(scrollElement);
    setViewportHeight(scrollElement.clientHeight);
    return () => resizeObserver.disconnect();
  };
  useEffect(syncViewportHeight, []);

  // grouped modes default to error-first: sev desc is the initial toggle state, not a fixed order
  const ensureGroupedSort = () => {
    const groupedIsSortable = GROUPED_COLS.some((col) => col.key === sortKey);
    if (mode !== "request" && !groupedIsSortable) setSort("severity", "desc");
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(ensureGroupedSort, [mode]);

  const applyFilterPatch = (patch: Partial<Filter>) => {
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

  const buildGroupedModel = () => {
    const sortDirection = sortDir === "desc" ? -1 : 1;
    const sortColumn = sortKey as GroupedKey;
    if (mode === "rule") {
      return buildGroupedRows(
        ruleGroups.map((group) => ({
          key: ruleGroupKey(group.rule),
          name: group.rule,
          cells: group.cells,
        })),
        sortDirection,
        sortColumn,
        expanded,
      );
    }
    if (mode === "file") {
      return buildGroupedRows(
        fileGroups.map((group) => ({
          key: fileGroupKey(group.file),
          name: group.file,
          cells: group.cells,
        })),
        sortDirection,
        sortColumn,
        expanded,
      );
    }
    return { flatRows: [], parentRows: [] };
  };
  const grouped = useMemo(buildGroupedModel, [
    mode,
    ruleGroups,
    fileGroups,
    expanded,
    sortKey,
    sortDir,
  ]);

  // a report-panel click is a fresh focus: close every group, expand only the chosen rule
  const focusReportedRule = () => {
    if (focusRule === null || mode !== "rule") return;
    const focusedRuleKey = ruleGroupKey(focusRule);
    setExpanded(new Set([focusedRuleKey]));
    const focusedParentIndex = grouped.parentRows.findIndex(
      (parentRow) => parentRow.key === focusedRuleKey,
    );
    if (focusedParentIndex >= 0)
      scrollRef.current?.scrollTo({ top: focusedParentIndex * ROW_HEIGHT });
    onFocusHandled();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(focusReportedRule, [focusRule, mode]);

  const visibleRange = useMemo(() => {
    // scrollTop includes the sticky header row; compensate before mapping to row indexes
    const scrollRows = Math.max(0, scrollTop - HEADER_HEIGHT);
    const first = Math.max(0, Math.floor(scrollRows / ROW_HEIGHT) - OVERSCAN);
    const visible = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const total = mode === "request" ? rows.length : grouped.flatRows.length;
    return { first, last: Math.min(total, first + visible) };
  }, [scrollTop, viewportHeight, rows.length, grouped, mode]);

  const activeFilterText = filter.text !== "" ? `text "${filter.text}"` : null;
  const activeText = activeFilterText !== null ? `active: ${activeFilterText}` : null;
  const totalCount =
    mode === "request"
      ? (query.data?.requestCount ?? 0)
      : mode === "rule"
        ? ruleGroups.length
        : fileGroups.length;
  const countNoun = mode === "request" ? "requests" : mode === "rule" ? "rules" : "files";
  const countText = query.isLoading
    ? "loading…"
    : `${mode === "request" ? rows.length : grouped.flatRows.length} / ${totalCount} ${countNoun}`;
  const isEmpty =
    !query.isLoading &&
    !query.isError &&
    (mode === "request" ? rows.length : grouped.flatRows.length) === 0;
  const emptyDetail = emptyStateNote(isEmpty, mode, query.data);

  const densityStrip =
    mode === "request" && !query.isLoading && rows.length > 0 ? <DensityStrip rows={rows} /> : null;
  const errorNotice = query.isError ? (
    <p className="p-rail text-sev-error">{String(query.error)}</p>
  ) : null;
  const emptyNotice = isEmpty ? (
    <EmptyNotice
      countNoun={countNoun}
      emptyDetail={emptyDetail}
      activeText={activeText}
      onClearFilters={() => setFilter({ text: "" })}
    />
  ) : null;
  const tableBody =
    mode === "request" ? (
      <RequestLog
        rows={rows}
        selectedFile={selectedFile}
        onSelectPair={onSelectPair}
        sortKey={sortKey}
        sortDir={sortDir}
        onToggleSort={(key) => toggleSort(key)}
      />
    ) : (
      <GroupedTreeView
        list={grouped.flatRows}
        range={visibleRange}
        mode={mode}
        ruleGroups={ruleGroups}
        fileGroups={fileGroups}
        expanded={expanded}
        onToggleExpand={toggleExpand}
        selectedFile={selectedFile}
        onSelectPair={onSelectPair}
        sortKey={sortKey}
        sortDir={sortDir}
        onToggleSort={(key) => toggleSort(key)}
      />
    );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Toolbar
        mode={mode}
        onMode={onMode}
        filterText={filter.text}
        onFilterText={(text) => applyFilterPatch({ text })}
        countText={countText}
      />
      {densityStrip}
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-auto"
      >
        {errorNotice}
        {emptyNotice}
        {tableBody}
      </div>
    </section>
  );
}
