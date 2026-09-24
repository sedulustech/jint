/**
 * DataHandle — the declarative handle form. A handle in a JSON config is data: two thresholds from
 * which polarity is inferred, never code. The direction field was dropped as derivable:
 *
 * - Warn_at < error_at => high-bad: a value above warn_at warns, above error_at errors.
 * - Error_at < warn_at => high-good: a value below warn_at warns, below error_at errors.
 *
 * Equal thresholds are meaningless (the bands have zero width both ways) and are rejected at
 * validation. compileHandle() is the only place data becomes function; every other consumer —
 * schema, defaults, loader — stays in data.
 */

import type { HandleResult } from "../types.ts";

/** The declarative handle: both thresholds required, polarity inferred from their ordering. */
export interface DataHandle {
  warn_at: number;
  error_at: number;
}

/** The compiled handle: value -> "error" | "warn" | null (null = silent). */
export type Handle = (value: number) => HandleResult;

/**
 * The single data -> function seam. warn_at < error_at fires upward (high-bad); the reverse fires
 * downward (high-good). Threshold comparisons are exclusive on the firing side: > at/< at.
 */
export function compileHandle(data: DataHandle): Handle {
  if (data.warn_at === data.error_at) {
    throw new Error(`handle thresholds must differ (warn_at = error_at = ${data.warn_at})`);
  }
  if (data.warn_at < data.error_at) {
    // high-bad: severity ascends upward
    return (value) => (value > data.error_at ? "error" : value > data.warn_at ? "warn" : null);
  }
  // high-good: severity ascends downward
  return (value) => (value < data.error_at ? "error" : value < data.warn_at ? "warn" : null);
}
