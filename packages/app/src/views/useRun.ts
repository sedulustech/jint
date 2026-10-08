import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchRun, fetchReport } from "../api/client";
import type { Cell, Report, RequestItem } from "../types";

export type Mode = "request" | "rule" | "file";
export type SortKey = "seq" | "rule" | "findings" | "maxProb";
type SortDir = "asc" | "desc";

export interface Filter {
  text: string;
}

function cmp(a: number | null, b: number | null): number {
  return (a ?? Number.NEGATIVE_INFINITY) - (b ?? Number.NEGATIVE_INFINITY);
}

/** Severity rank: error > warn > no provable verdict. The ONLY non-plain comparator. */
export const sevRank = (s: "error" | "warn" | null): number =>
  s === "error" ? 2 : s === "warn" ? 1 : 0;

export interface GroupStats {
  err: number;
  warn: number;
  /** Cells without a provable verdict - absence of a finding, never a "clean" claim. */
  passOk: number;
}
export interface RuleGroup {
  rule: string;
  stats: GroupStats & { targets: number };
  cells: Cell[];
}
export interface FileGroup {
  file: string;
  stats: GroupStats & { rules: number; cells: number };
  cells: Cell[];
}

const statsFor = (cells: Cell[]) => ({
  err: cells.filter((c) => c.severity === "error").length,
  warn: cells.filter((c) => c.severity === "warn").length,
  passOk: cells.filter((c) => c.severity === null).length,
});

export function useRun(runId: string) {
  const query = useQuery({ queryKey: ["run", runId], queryFn: () => fetchRun(runId) });
  const [sortKey, setSortKey] = useState<SortKey>("seq");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState<Filter>({ text: "" });

  const report = useQuery({
    queryKey: ["report", runId],
    queryFn: () => fetchReport(runId),
  });

  const reportData = useMemo(() => {
    const d = report.data;
    return d && !("absent" in d) ? (d as Report) : undefined;
  }, [report.data]);

  // the API edge owns severity (finding join + handle projection); the client never re-derives
  const severityOf = (r: RequestItem): "error" | "warn" | null => r.severity;

  const rows = useMemo(() => {
    const all = query.data?.results ?? [];
    const terms = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = all.filter((r) => {
      // every whitespace-separated term must hit path, rule, or severity
      if (terms.length > 0) {
        const hay = [r.path ?? "", r.rules.join(" "), r.severity ?? ""].join(" ").toLowerCase();
        if (!terms.every((term) => hay.includes(term))) return false;
      }
      return true;
    });
    const dir = sortDir === "desc" ? -1 : 1;
    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "seq":
          return dir * (a.seq - b.seq);
        case "maxProb":
          return dir * cmp(a.maxProb, b.maxProb);
        case "rule":
          return dir * (a.rules[0] ?? "").localeCompare(b.rules[0] ?? "");
        default:
          return 0;
      }
    });
    return sorted;
  }, [query.data, filter, sortKey, sortDir, severityOf]);

  // --- group index: rule-target cells grouped by rule and by file, text-filtered ---
  const { ruleGroups, fileGroups } = useMemo(() => {
    const cells = query.data?.cells ?? [];
    const terms = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (c: Cell) =>
      terms.length === 0 ||
      terms.every((t) =>
        [c.rule, c.file, c.input, c.severity ?? ""].join(" ").toLowerCase().includes(t),
      );
    const byRule = new Map<string, Cell[]>();
    const byFile = new Map<string, Cell[]>();
    for (const c of cells) {
      if (!hit(c)) continue;
      const r = byRule.get(c.rule);
      if (r) r.push(c);
      else byRule.set(c.rule, [c]);
      const f = byFile.get(c.file);
      if (f) f.push(c);
      else byFile.set(c.file, [c]);
    }
    const ruleGroups: RuleGroup[] = [...byRule].map(([rule, cs]) => ({
      rule,
      cells: cs,
      stats: { ...statsFor(cs), targets: cs.length },
    }));
    const fileGroups: FileGroup[] = [...byFile].map(([file, cs]) => ({
      file,
      cells: cs,
      stats: { ...statsFor(cs), rules: new Set(cs.map((c) => c.rule)).size, cells: cs.length },
    }));
    return { ruleGroups, fileGroups };
  }, [query.data, filter.text]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return {
    query,
    reportData,
    rows,
    ruleGroups,
    fileGroups,
    filter,
    setFilter,
    sortKey,
    sortDir,
    toggleSort,
    setSort: (key: SortKey, dir: SortDir) => {
      setSortKey(key);
      setSortDir(dir);
    },
    severityOf,
  };
}
