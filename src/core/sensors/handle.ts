/**
 * The typed handler taxonomy. The question type decides which handler is valid:
 *
 * - ScoreHandler (choice questions, graded criteria levels): { map } — one level per criterion,
 *   direction expressed by the map itself (high-bad: ["pass","pass","warn","error"]; high-good:
 *   ["error","warn","pass","pass"]).
 * - NoulHandler (noul questions, the claim probability P(true)): { fires_when, warn_at, error_at?,
 *   silent_band? }. fires_when names the defect pole — REQUIRED, no default (declaration over
 *   inference). Thresholds sit on the defect pole (P is flipped first when fires_when is "false");
 *   warn_at < error_at there. silent_band absent = everything surfaces (explicit, no engine
 *   default).
 *
 * Handlers are data, never code; compileHandle() is the only place data becomes function; every
 * other consumer — schema, defaults, loader — stays in data.
 */

import { SetupError, type HandleOutcome } from "../types.ts";
// The taxonomy and the pure evaluation live in the contract package (one definition, shared with
// the measurement UI); the engine owns only the compiled seams (handle data -> function).
export {
  checkCondition,
  checkNoulHandler,
  conditionFires,
  handleSeverity,
  isScoreHandler,
  type HandlerData,
  type HandlerLevel,
  type NoulHandlerData,
  type ScoreHandlerData,
  type ThresholdCondition,
} from "@jint/contract";

import { handleSeverity, type NoulHandlerData, type ScoreHandlerData } from "@jint/contract";

/** The compiled handle: value -> outcome, or null (silent). */
export type Handle = (value: number) => HandleOutcome | null;

/**
 * The single data -> function seam for noul rules. Direction is declared per threshold (the
 * operator IS the pole - greater_than / less_than on the raw value); comparisons are strict on the
 * firing side, so a reading exactly at a threshold stays silent. A silent_band hit suppresses
 * before any threshold is consulted. The contract evaluator owns these semantics.
 */
export function compileNoulHandler(data: NoulHandlerData): Handle {
  // the contract evaluator owns the semantics (operators, band, strict comparisons)
  return (value) => {
    const severity = handleSeverity(value, data);
    return severity === null ? null : { severity };
  };
}

/**
 * The single data -> function seam for choice rules: the map indexes the score axis (0..N).
 * Findings carry no message — consumers join by rule id to the config (v1 contract).
 */
export function compileScoreHandler(data: ScoreHandlerData): Handle {
  return (value) => {
    // jev bounds score to the criteria count, so an out-of-scale or NaN score is an impossible
    // state, not a silent null - fail loud (SetupError INTERNAL), per repo convention (the
    // contract evaluator alone would degrade to silent).
    const index = Math.round(value);
    if (!Number.isInteger(index) || index < 0 || index >= data.map.length) {
      throw new SetupError(
        "INTERNAL",
        `score ${value} is outside the criteria scale 0..${data.map.length - 1} - the classifier returned an out-of-bounds score`,
      );
    }
    const severity = handleSeverity(index, data);
    return severity === null ? null : { severity };
  };
}
