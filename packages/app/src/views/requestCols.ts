/**
 * Request-mode column spec - the ONE source of truth for the request-log grid. The header
 * (RequestTable) and the row cells (Row) both consume this; widths live here so the two can never
 * drift again (they drifted once: the rule column drop left the row at w-10 while the header went
 * w-16).
 *
 * `path` has no width: it is the flex-1 tail that absorbs the remaining space.
 */
export const REQ_COLS = [
  { key: "seq" as const, label: "seq", width: "w-14" },
  { key: "severity" as const, label: "severity", width: "w-24" },
  { key: "maxProb" as const, label: "max-p", width: "w-20" },
  // question count = rules judged in this request; sorts with rule (data, not signal)
  { key: "rule" as const, label: "rule count", width: "w-16" },
];

export type ReqColKey = (typeof REQ_COLS)[number]["key"];
