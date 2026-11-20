/**
 * Request-mode column spec - the ONE source of truth for the request-log grid. The header
 * (RequestTable) and the row cells (Row) both consume this, so they share each column's width.
 *
 * `path` has no width: it is the flex-1 tail that absorbs the remaining space.
 */
export const REQUEST_COLUMNS = [
  { key: "seq" as const, label: "seq", width: "w-14" },
  { key: "findings" as const, label: "findings", width: "w-24" },
  { key: "maxProb" as const, label: "max-p", width: "w-20" },
  // question count = rules judged in this request; sorts with rule (data, not signal)
  { key: "rule" as const, label: "rule count", width: "w-24" },
  // latency of the classifier call: its recorded durationMs, else estimated from file times
  { key: "duration" as const, label: "duration", width: "w-20" },
];

export type RequestColumnKey = (typeof REQUEST_COLUMNS)[number]["key"];
