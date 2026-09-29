import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchRun, fetchReport } from "../api/client";
import type { Report, RequestSummary } from "../types";

type SortKey = "borderline" | "seq" | "rule" | "severity" | "maxProb";
type SortDir = "asc" | "desc";

export interface Filter {
  text: string;
  band: "" | "borderline";
}

function cmp(a: number | null, b: number | null): number {
  return (a ?? Number.NEGATIVE_INFINITY) - (b ?? Number.NEGATIVE_INFINITY);
}

export function useRun(runId: string, ruleFilter: string | null = null) {
  const query = useQuery({ queryKey: ["run", runId], queryFn: () => fetchRun(runId) });
  // Default: most-undecided first. The boring 0.8s sink; calibration work is triage.
  const [sortKey, setSortKey] = useState<SortKey>("borderline");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState<Filter>({ text: "", band: "" });

  const report = useQuery({
    queryKey: ["report", runId],
    queryFn: () => fetchReport(runId),
  });

  const reportData = useMemo(() => {
    const d = report.data;
    return d && !("absent" in d) ? (d as Report) : undefined;
  }, [report.data]);

  // the API edge owns severity (finding join + handle projection); the client never re-derives
  const severityOf = (r: RequestSummary): "error" | "warn" | null => r.severity;

  const sevRank = (r: RequestSummary): number =>
    severityOf(r) === "error" ? 2 : severityOf(r) === "warn" ? 1 : 0;

  const rows = useMemo(() => {
    const all = query.data?.requests ?? [];
    const terms = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = all.filter((r) => {
      if (ruleFilter !== null && !r.rules.includes(ruleFilter)) return false;
      if (filter.band === "borderline" && (r.borderline === null || r.borderline > 0.2)) {
        return false;
      }
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
        // error > warn > no provable severity
        case "severity":
          return dir * (sevRank(b) - sevRank(a) || cmp(a.seq, b.seq));
        // Sort by the distance of the capture's STRONGEST answer (max-p, the visible number)
        // from 0.5. The per-answer closest distance (row.borderline) ties at 0 for the ~2/3 of
        // captures holding an exact-0.5 answer, so it is tie-break only.
        case "borderline":
          return (
            dir *
              cmp(
                a.maxProb === null ? null : Math.abs(a.maxProb - 0.5),
                b.maxProb === null ? null : Math.abs(b.maxProb - 0.5),
              ) || dir * cmp(a.borderline, b.borderline)
          );
        case "rule":
          return dir * (a.rules[0] ?? "").localeCompare(b.rules[0] ?? "");
        default:
          return 0;
      }
    });
    return sorted;
  }, [query.data, filter, sortKey, sortDir, ruleFilter]);

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
    filter,
    setFilter,
    sortKey,
    sortDir,
    toggleSort,
    severityOf,
  };
}
