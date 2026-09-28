/**
 * The typed handler taxonomy. The question type decides which handler is valid:
 *
 * - ScoreHandler (choice questions, graded criteria levels): { map } — one level per criterion,
 *   direction expressed by the map itself (high-bad: ["ok","ok","warn","error"]; high-good:
 *   ["error","warn","ok","ok"]). A fired level's finding message defaults to that level's criteria
 *   line verbatim.
 * - NoulHandler (noul questions, the claim probability P(true)): { fires_when, warn_at, error_at?,
 *   silent_band? }. fires_when names the defect pole — REQUIRED, no default (declaration over
 *   inference). Thresholds sit on the defect pole (P is flipped first when fires_when is "false");
 *   warn_at < error_at there. silent_band absent = everything surfaces (explicit, no engine
 *   default).
 *
 * Handlers are data, never code; compileHandle() is the only place data becomes function; every
 * other consumer — schema, defaults, loader — stays in data.
 */

import type { HandleOutcome } from "../types.ts";

/** One graded criteria level, as declared in a ScoreHandler map. */
export type HandlerLevel = "ok" | "warn" | "error";

/** The score-type handler: one level per criteria entry, at least one non-"ok". */
export interface ScoreHandlerData {
  readonly map: readonly HandlerLevel[];
}

/** The noul-type handler: defect pole declared, thresholds on it, optional silent band. */
export interface NoulHandlerData {
  readonly fires_when: "true" | "false";
  readonly warn_at: number;
  readonly error_at?: number;
  /** Defect-pole readings inside [lo, hi] (inclusive) stay silent; absent = everything surfaces. */
  readonly silent_band?: readonly [number, number];
}

/** A declarative handler: exactly one of the two typed forms. */
export type HandlerData = ScoreHandlerData | NoulHandlerData;

/** The compiled handle: value -> outcome, or null (silent). */
export type Handle = (value: number) => HandleOutcome | null;

/** Type guard: is this handler data the score form? */
export function isScoreHandler(data: HandlerData): data is ScoreHandlerData {
  return "map" in data;
}

/**
 * The shared noul-handler invariant check: null when valid, otherwise the field name + problem (the
 * caller prefixes rule id and source). Used by both the JSON loader (CONFIG_INVALID) and the
 * TS-rule loader (RULE_INVALID), so the two tiers cannot drift.
 */
export function checkNoulHandler(data: NoulHandlerData): string | null {
  if (data.warn_at <= 0 || data.warn_at >= 1) {
    return `handle.warn_at: must be within (0, 1), got ${data.warn_at}`;
  }
  if (data.error_at !== undefined) {
    if (data.error_at <= 0 || data.error_at >= 1) {
      return `handle.error_at: must be within (0, 1), got ${data.error_at}`;
    }
    if (data.warn_at >= data.error_at) {
      return `handle.warn_at: thresholds are on the defect pole (fires_when "${data.fires_when}") and must be ordered warn_at < error_at, got ${data.warn_at} >= ${data.error_at}`;
    }
  }
  if (data.silent_band !== undefined && data.silent_band[0] >= data.silent_band[1]) {
    return `handle.silent_band: must be ordered [lower, upper], got [${data.silent_band[0]}, ${data.silent_band[1]}]`;
  }
  return null;
}

/**
 * The single data -> function seam for noul rules. Readings are projected onto the defect pole (P
 * flips when fires_when is "false"); comparisons are exclusive on the firing side (> at), so a
 * reading exactly at a threshold stays in the band below it. A silent_band hit suppresses before
 * any threshold is consulted.
 */
export function compileNoulHandler(data: NoulHandlerData): Handle {
  const flip = data.fires_when === "false";
  const band = data.silent_band;
  return (value) => {
    const defect = flip ? 1 - value : value;
    if (band !== undefined && defect >= band[0] && defect <= band[1]) return null;
    if (data.error_at !== undefined && defect > data.error_at) return { severity: "error" };
    if (defect > data.warn_at) return { severity: "warn" };
    return null;
  };
}

/**
 * The single data -> function seam for choice rules: the map indexes the score axis (0..N). A fired
 * level carries that level's criteria line verbatim as the finding message; the caller (lint)
 * prefixes the element reference.
 */
export function compileScoreHandler(data: ScoreHandlerData, criteria: readonly string[]): Handle {
  return (value) => {
    const index = Math.round(value);
    const level = data.map[index];
    if (level === undefined || level === "ok") return null;
    return { severity: level, message: criteria[index] };
  };
}
