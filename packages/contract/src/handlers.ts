/**
 * The handler contract: the typed handle taxonomy and the pure evaluation functions both the engine
 * and the measurement UI consume. Zero dependencies, runtime-free - data and functions only, no
 * I/O, no engine types.
 *
 * Noul direction is DECLARED PER THRESHOLD: warn/error each carry one comparison operator ({
 * greater_than: x } or { less_than: x }). There is no defect pole and no flip - the operator IS the
 * pole. warn fires the wider region, error the strictly narrower one (same direction), so error
 * implies warn. A silent_band suppresses raw-p readings inside [lo, hi] (inclusive) before any
 * threshold is consulted - the two-sided suppression window that single comparison operators cannot
 * express.
 */

/** One graded criteria level, as declared in a ScoreHandler map. */
export type HandlerLevel = "pass" | "warn" | "error";

/** The score-type handler: one level per criteria entry, at least one non-"pass". */
export interface ScoreHandlerData {
  readonly map: readonly HandlerLevel[];
}

/** One threshold's comparison: exactly one operator, declared at the threshold. */
export interface ThresholdCondition {
  readonly greater_than?: number;
  readonly less_than?: number;
}

/** The noul-type handler: per-threshold operators, optional silent band. */
export interface NoulHandlerData {
  readonly warn: ThresholdCondition;
  readonly error?: ThresholdCondition;
  /** Raw-p readings inside [lo, hi] (inclusive) stay silent; absent = everything surfaces. */
  readonly silent_band?: readonly [number, number];
}

/** A declarative handler: exactly one of the two typed forms. */
export type HandlerData = ScoreHandlerData | NoulHandlerData;

/** Severity is the only verdict vocabulary: a finding fires error or warn, or stays silent. */
export type Severity = "error" | "warn";

/** Type guard: is this handler data the score form? */
export function isScoreHandler(data: HandlerData): data is ScoreHandlerData {
  return "map" in data;
}

/** Does one threshold condition fire at this value? Strict on the firing side. */
export function conditionFires(value: number, condition: ThresholdCondition): boolean {
  if (condition.greater_than !== undefined) return value > condition.greater_than;
  if (condition.less_than !== undefined) return value < condition.less_than;
  // validated upstream: a condition carries exactly one operator
  return false;
}

/**
 * Pure handle evaluation: value -> severity, or null (silent). The single semantics both the
 * engine's compiled handle and the UI's severity projection share, so the two cannot drift.
 *
 * Noul: a silent_band hit (inclusive) suppresses before any threshold is consulted; warn and error
 * conditions are evaluated on the RAW value - direction lives in the operators, so no polarity
 * interpretation happens here at all. Error implies warn by validation (narrower).
 *
 * Score: the value indexes the criteria map (rounded). Out-of-range is an impossible state the
 * ENGINE fails loud on before this evaluator runs; here it degrades to silent (null), never a
 * fabricated verdict.
 */
export function handleSeverity(value: number, data: HandlerData): Severity | null {
  if (isScoreHandler(data)) {
    const index = Math.round(value);
    if (!Number.isInteger(index) || index < 0 || index >= data.map.length) return null;
    // bounds checked above guarantee the level
    const level = data.map[index]!;
    return level === "pass" ? null : level;
  }
  const band = data.silent_band;
  if (band !== undefined && value >= band[0] && value <= band[1]) return null;
  if (data.error !== undefined && conditionFires(value, data.error)) return "error";
  if (conditionFires(value, data.warn)) return "warn";
  return null;
}

/**
 * Score resolution: the full answer -> severity. DEFAULT read (the only one that ships) is
 * round-to-nearest-level — the docs-blessed projection; probabilities and confidence are carried
 * for future reads but no rule consumes them yet (distribution-aware reads land only when a rule's
 * calibration demands them). Delegates to the level-index logic of handleSeverity.
 */
export function resolveScore(
  value: number,
  probabilities: Record<string, number> | undefined,
  confidence: number | undefined,
  data: ScoreHandlerData,
): Severity | null {
  void probabilities;
  void confidence;
  return handleSeverity(value, data);
}

/** One condition carries exactly one operator: null when valid, else the problem. */
export function checkCondition(condition: ThresholdCondition, field: string): string | null {
  const ops = [condition.greater_than !== undefined, condition.less_than !== undefined].filter(
    Boolean,
  ).length;
  if (ops === 0) return `${field}: must declare one operator (greater_than or less_than)`;
  if (ops > 1) return `${field}: declare exactly one operator, got both greater_than and less_than`;
  const value = (condition.greater_than ?? condition.less_than)!;
  if (value <= 0 || value >= 1) {
    return `${field}: threshold must be within (0, 1), got ${value}`;
  }
  return null;
}

/**
 * The shared noul-handler invariant check: null when valid, otherwise the field name + problem (the
 * caller prefixes rule id and source). Used by the JSON loader and the TS-rule loader so the two
 * tiers cannot drift.
 */
export function checkNoulHandler(data: NoulHandlerData): string | null {
  const warnProblem = checkCondition(data.warn, "handle.warn");
  if (warnProblem !== null) return warnProblem;
  if (data.error !== undefined) {
    const errorProblem = checkCondition(data.error, "handle.error");
    if (errorProblem !== null) return errorProblem;
    // error must be the narrower region: same direction, ordered toward the defect
    if (data.warn.greater_than !== undefined && data.error.greater_than !== undefined) {
      if (data.warn.greater_than >= data.error.greater_than) {
        return `handle.warn/error: greater_than thresholds must be ordered warn < error (error is the narrower region), got ${data.warn.greater_than} >= ${data.error.greater_than}`;
      }
    }
    if (data.warn.less_than !== undefined && data.error.less_than !== undefined) {
      if (data.warn.less_than <= data.error.less_than) {
        return `handle.warn/error: less_than thresholds must be ordered warn > error (error is the narrower region), got ${data.warn.less_than} <= ${data.error.less_than}`;
      }
    }
  }
  if (data.silent_band !== undefined) {
    const [lo, hi] = data.silent_band;
    if (lo >= hi) {
      return `handle.silent_band: must be ordered [lower, upper], got [${lo}, ${hi}]`;
    }
    // A band covering the whole scale would silence every reading; a band containing a
    // threshold value would swallow exactly the readings that threshold exists to catch.
    if (lo <= 0 && hi >= 1) {
      return "handle.silent_band: must not cover the whole scale (got [0, 1]) - everything would be silent";
    }
    for (const [field, condition] of [
      ["warn", data.warn],
      ["error", data.error],
    ] as const) {
      if (condition === undefined) continue;
      const at = condition.greater_than ?? condition.less_than;
      if (at !== undefined && lo <= at && at <= hi) {
        return `handle.silent_band: [${lo}, ${hi}] contains the ${field} threshold (${at}) - a band must not contain the thresholds it sits against`;
      }
    }
  }
  return null;
}
