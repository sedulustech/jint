import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ROW_CURSOR, ROW_HOVER } from "../lib/row";
import { SEVERITY } from "./color";
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
// header + rows scroll horizontally together below this width: fixed columns would otherwise
// collapse the path column to an ellipsis

// grouped mode: TWO tables. The outer table is group-level only (name | findings); each
// expanded parent hosts a NESTED table with its own header (input | severity | value), so
// child columns never leak into the group header and the name column says rule OR file
// (the group-by mode already knows which).

const compareText = (left: string, right: string) => left.localeCompare(right);

const ruleGroupKey = (rule: string): string => "rule:" + rule;
const fileGroupKey = (file: string): string => "file:" + file;

interface ParentRow {
  key: string;
  name: string;
  cells: Cell[];
}

// parents order by FINDINGS, heaviest first: the weighted score (err=2, warn=1) keeps 1 error
// above 1 warning while 4 warnings outweigh 1 error; ties fall back to the name
const findingsScore = (cells: Cell[]): number =>
  cells.reduce((sum, c) => sum + (c.severity === "error" ? 2 : c.severity === "warn" ? 1 : 0), 0);

/**
 * Grouped render model: parent rows order by findings weight, heaviest first; children keep cell
 * order inside their parent's nested table.
 */
function buildGroupedParents(
  groupSpecs: { key: string; name: string; cells: Cell[] }[],
): ParentRow[] {
  return groupSpecs
    .map((groupSpec) => ({ key: groupSpec.key, name: groupSpec.name, cells: groupSpec.cells }))
    .sort(
      (left, right) =>
        findingsScore(right.cells) - findingsScore(left.cells) ||
        compareText(left.name, right.name),
    );
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
      variant="secondary"
      size="sm"
      onClick={() => onMode(buttonMode)}
      aria-pressed={mode === buttonMode}
      data-testid={`mode-${buttonMode}`}
      className={mode === buttonMode ? "text-body" : "border border-input text-body"}
    >
      {label}
    </Button>
  );
  return (
    <div role="group" aria-label="group by" className="flex items-center gap-related">
      <span className="text-caption text-muted-foreground">group by</span>
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
  countText: string | null;
}) {
  return (
    <div className="flex items-center gap-siblings border-b border-border bg-muted px-rail py-bar-y">
      <ModeButtons mode={mode} onMode={onMode} />
      <input
        value={filterText}
        onChange={(e) => onFilterText(e.target.value)}
        placeholder="filter: path, rule, element id…"
        className="h-7 w-64 rounded-lg border border-input bg-background px-control-x text-body text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {countText !== null && (
        <span data-testid="group-count" className="ml-auto text-body text-muted-foreground">
          {countText}
        </span>
      )}
    </div>
  );
}

function GroupedHeader({ mode }: { mode: Mode }) {
  return (
    <thead className="sticky top-0 z-10 border-b border-border bg-muted text-body text-foreground">
      <tr>
        <th scope="col" className="w-px whitespace-nowrap px-rail py-bar-y text-left font-normal">
          {mode === "rule" ? "rule" : "file"}
        </th>
        <th scope="col" className="w-px whitespace-nowrap px-rail py-bar-y text-left font-normal">
          findings
        </th>
        <th scope="col" className="w-full" aria-hidden="true" />
      </tr>
    </thead>
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
    <thead className="sticky top-0 z-10 border-b border-border bg-muted text-body text-foreground">
      <tr>
        {REQUEST_COLUMNS.map((col) => (
          <th
            key={col.label}
            className={`${col.width} whitespace-nowrap px-rail py-cell-y text-left font-normal`}
          >
            <button
              data-testid={`sort-${col.key}`}
              onClick={() => onToggleSort(col.key)}
              className="w-full cursor-pointer text-left hover:text-foreground"
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
  return (
    <tr
      data-testid={`group-${row.key}`}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onClick={() => onToggleExpand(row.key)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleExpand(row.key);
        }
      }}
      className={`${ROW_CURSOR} border-b border-border bg-background text-left text-body text-foreground hover:bg-accent ${
        isExpanded ? "font-bold" : ""
      }`}
      style={{ height: ROW_HEIGHT }}
    >
      {/* parents share the outer table's column grid; hierarchy reads from weight, never from
          shifting a column off the grid */}
      <td className="max-w-[48rem] truncate px-rail" title={row.name}>
        {row.name}
      </td>
      <td className="whitespace-nowrap px-rail">
        {stats.err > 0 || stats.warn > 0 ? (
          <span className="text-muted-foreground">
            {stats.err > 0 && <span className="text-sev-error">{stats.err} err</span>}
            {stats.err > 0 && stats.warn > 0 && " · "}
            {stats.warn > 0 && <span className="text-sev-warn">{stats.warn} warn</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="w-full" aria-hidden="true" />
    </tr>
  );
}

type NestedSort = { key: "sev" | "value"; dir: "asc" | "desc" };

// unset sort = severity heaviest-first: the default view answers "what is worst here"
const NESTED_DEFAULT_SORT: NestedSort = { key: "sev", dir: "desc" };

const nestedCompare =
  (sort: NestedSort) =>
  (left: Cell, right: Cell): number => {
    const delta =
      sort.key === "sev"
        ? sevRank(right.severity) - sevRank(left.severity)
        : right.value - left.value;
    return sort.dir === "desc" ? delta : -delta;
  };

/**
 * The nested table under one expanded parent: its own header (input | severity | value) so child
 * columns never leak into the group header. Severity and value fit their content (nowrap on a w-px
 * column); the name column takes the remaining width and truncates - max-w-96 keeps a long input
 * path from widening the panel.
 */
function GroupedNestedTable({
  mode,
  parentKey,
  cells,
  selectedFile,
  onSelectPair,
  sort,
  onToggle,
}: {
  mode: Mode;
  parentKey: string;
  cells: Cell[];
  selectedFile: string | null;
  onSelectPair: (pair: Pair) => void;
  sort: NestedSort | undefined;
  onToggle: (parentKey: string, key: "sev" | "value") => void;
}) {
  const sortHeader = (key: "sev" | "value", label: string) => (
    <th scope="col" className="w-px whitespace-nowrap px-rail text-left font-normal">
      <button
        data-testid={`nested-sort-${key}`}
        onClick={() => onToggle(parentKey, key)}
        className="w-full cursor-pointer text-left hover:text-foreground"
      >
        {label}
      </button>
    </th>
  );
  return (
    // full width, but the slack must trail the last content column, never stretch the gaps
    // between them: the content columns pin to their content (w-px nowrap floor) and the
    // empty trailing cell takes width:100%, which auto layout resolves to ALL leftover space.
    // (table-fixed cannot express this - fixed columns cannot hug their content.)
    // The name column is capped so a long name ellipsizes rather than widening the panel.
    <table className="w-full">
      <thead className="border-b border-border bg-background text-caption text-muted-foreground">
        <tr style={{ height: ROW_HEIGHT }}>
          <th scope="col" className="pl-indent pr-rail text-left font-normal">
            {mode === "rule" ? "input" : "rule"}
          </th>
          {sortHeader("sev", "severity")}
          {sortHeader("value", "value")}
          <th className="w-full" aria-hidden="true" />
        </tr>
      </thead>
      <tbody>
        {[...cells].sort(nestedCompare(sort ?? NESTED_DEFAULT_SORT)).map((cell) => (
          <GroupedChildRow
            key={cell.rule + "\u0000" + cell.input}
            cell={cell}
            mode={mode}
            selected={selectedFile === cell.file}
            onSelectPair={onSelectPair}
          />
        ))}
      </tbody>
    </table>
  );
}

function GroupedChildRow({
  cell,
  mode,
  selected,
  onSelectPair,
}: {
  cell: Cell;
  mode: Mode;
  selected: boolean;
  onSelectPair: (pair: Pair) => void;
}) {
  // The child's identity axis follows the parent: in rule mode the parent is the rule, so the
  // child names the file it fired on; in file mode the reverse. Same grid either way.
  const childName = mode === "rule" ? cell.file : cell.rule;
  const childLocation =
    cell.element === undefined || cell.element.kind === "file"
      ? null
      : spanLabel(cell.element.span);
  const select = () =>
    onSelectPair({ rule: cell.rule, input: cell.input, requestFile: cell.requestFile });
  return (
    <tr
      data-testid={`cell-${cell.rule}@${cell.input}`}
      role="button"
      tabIndex={0}
      onClick={select}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select();
        }
      }}
      style={{ height: ROW_HEIGHT }}
      className={`${ROW_CURSOR} border-b border-border text-left text-body ${
        selected ? "bg-accent text-accent-foreground" : ROW_HOVER
      } text-foreground`}
    >
      {/* nested grid: input | severity | value (own header above, pl-indent nesting) */}
      <td className="max-w-96 overflow-hidden">
        <span
          className="flex items-center gap-siblings truncate pl-indent pr-rail"
          title={childLocation !== null ? `${cell.file}:${childLocation}` : cell.file}
        >
          <span className="truncate">{childName}</span>
          <span className="shrink-0 text-caption text-muted-foreground">
            {childLocation !== null ? childLocation : "(file)"}
          </span>
        </span>
      </td>
      <td className="w-px whitespace-nowrap px-rail">
        <SeverityDot severity={cell.severity} />
      </td>
      <td className="w-px whitespace-nowrap px-rail">{cell.value.toFixed(2)}</td>
      <td className="w-full" aria-hidden="true" />
    </tr>
  );
}

// Real table (not a virtualized flex grid): the <thead> owns the column widths via
// table-fixed, and every row derives alignment from it - the literal-sync drift class
// (header at w-16 while rows stayed w-10) cannot happen. The request log is at most a
// few hundred rows (~8k px), which the DOM renders fine without windowing.
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
    <table className="w-full text-body">
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
  parents,
  mode,
  ruleGroups,
  fileGroups,
  expanded,
  onToggleExpand,
  selectedFile,
  onSelectPair,
  nestedSorts,
  onToggleNestedSort,
}: {
  parents: ParentRow[];
  mode: Mode;
  ruleGroups: RuleGroup[];
  fileGroups: FileGroup[];
  expanded: Set<string>;
  onToggleExpand: (key: string) => void;
  selectedFile: string | null;
  onSelectPair: (pair: Pair) => void;
  nestedSorts: Record<string, NestedSort>;
  onToggleNestedSort: (parentKey: string, key: "sev" | "value") => void;
}) {
  return (
    <table className="w-full">
      <GroupedHeader mode={mode} />
      <tbody>
        {parents.map((parentRow) => (
          <Fragment key={parentRow.key}>
            <GroupedParentRow
              row={parentRow}
              stats={groupStatsFor(mode, ruleGroups, fileGroups, parentRow)}
              isExpanded={expanded.has(parentRow.key)}
              onToggleExpand={onToggleExpand}
            />
            {expanded.has(parentRow.key) && (
              <tr>
                <td colSpan={3} className="p-0">
                  <GroupedNestedTable
                    mode={mode}
                    parentKey={parentRow.key}
                    cells={parentRow.cells}
                    selectedFile={selectedFile}
                    onSelectPair={onSelectPair}
                    sort={nestedSorts[parentRow.key]}
                    onToggle={onToggleNestedSort}
                  />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
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
    <div
      data-testid="empty-state"
      className="flex h-32 flex-col items-center justify-center gap-siblings text-body text-muted-foreground"
    >
      <p>0 {countNoun} match your filters</p>
      {emptyDetail !== null && <p className="text-muted-foreground">{emptyDetail}</p>}
      {activeText !== null && <p className="text-muted-foreground">{activeText}</p>}
      <Button variant="secondary" size="sm" onClick={onClearFilters}>
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
  const { query, rows, ruleGroups, fileGroups, filter, setFilter, sortKey, sortDir, toggleSort } =
    useRun(runId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // per-expansion nested-table sort: parentKey -> active column; first click heaviest-first
  const [nestedSorts, setNestedSorts] = useState<Record<string, NestedSort>>({});
  const toggleNestedSort = (parentKey: string, key: "sev" | "value") =>
    setNestedSorts((prev) => {
      const cur = prev[parentKey] ?? { key: "sev", dir: "desc" };
      const next: NestedSort =
        cur?.key === key ? { key, dir: cur.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" };
      return { ...prev, [parentKey]: next };
    });
  const scrollRef = useRef<HTMLDivElement>(null);

  // grouped modes default to error-first: sev desc is the initial toggle state, not a fixed order
  const ensureGroupedSort = () => {};
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
    if (mode === "rule") {
      return buildGroupedParents(
        ruleGroups.map((group) => ({
          key: ruleGroupKey(group.rule),
          name: group.rule,
          cells: group.cells,
        })),
      );
    }
    if (mode === "file") {
      return buildGroupedParents(
        fileGroups.map((group) => ({
          key: fileGroupKey(group.file),
          name: group.file,
          cells: group.cells,
        })),
      );
    }
    return [];
  };
  const grouped = useMemo(buildGroupedModel, [mode, ruleGroups, fileGroups]);

  // a report-panel click is a fresh focus: close every group, expand only the chosen rule
  const focusReportedRule = () => {
    if (focusRule === null || mode !== "rule") return;
    const focusedRuleKey = ruleGroupKey(focusRule);
    setExpanded(new Set([focusedRuleKey]));
    const focusedParentIndex = grouped.findIndex((parentRow) => parentRow.key === focusedRuleKey);
    if (focusedParentIndex >= 0)
      scrollRef.current?.scrollTo({ top: focusedParentIndex * ROW_HEIGHT });
    onFocusHandled();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(focusReportedRule, [focusRule, mode]);

  const activeFilterText = filter.text !== "" ? `text "${filter.text}"` : null;
  const activeText = activeFilterText !== null ? `active: ${activeFilterText}` : null;
  const totalCount =
    mode === "request"
      ? (query.data?.requestCount ?? 0)
      : mode === "rule"
        ? ruleGroups.length
        : fileGroups.length;
  const countNoun = mode === "request" ? "requests" : mode === "rule" ? "rules" : "files";
  // rule mode drops the X/Y count: the total lives in the run header
  const countText = query.isLoading
    ? "loading…"
    : mode === "rule"
      ? null
      : `${mode === "request" ? rows.length : grouped.length} / ${totalCount} ${countNoun}`;
  const isEmpty =
    !query.isLoading && !query.isError && (mode === "request" ? rows.length : grouped.length) === 0;
  const emptyDetail = emptyStateNote(isEmpty, mode, query.data);

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
        parents={grouped}
        mode={mode}
        ruleGroups={ruleGroups}
        fileGroups={fileGroups}
        expanded={expanded}
        onToggleExpand={toggleExpand}
        selectedFile={selectedFile}
        onSelectPair={onSelectPair}
        nestedSorts={nestedSorts}
        onToggleNestedSort={toggleNestedSort}
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
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {errorNotice}
        {emptyNotice}
        {tableBody}
      </div>
    </section>
  );
}
