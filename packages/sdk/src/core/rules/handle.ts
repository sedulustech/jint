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

import { checkNoulHandler, type HandlerData } from "@jint/contract";
import { Type } from "@sinclair/typebox";
import { InternalError, SetupError, type HandleOutcome } from "../types.ts";
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

import {
  handleSeverity,
  resolveScore,
  type ClassifiedAnswer,
  type NoulHandlerData,
  type ScoreHandlerData,
} from "@jint/contract";
export type { ClassifiedAnswer };

/** The compiled handle: the full classified answer -> outcome, or null (silent). */
export type Handle = (answer: ClassifiedAnswer) => HandleOutcome | null;

/**
 * The single data -> function seam for noul rules. Direction is declared per threshold (the
 * operator IS the pole - greater_than / less_than on the raw value); comparisons are strict on the
 * firing side, so a reading exactly at a threshold stays silent. A silent_band hit suppresses
 * before any threshold is consulted. The contract evaluator owns these semantics.
 */
export function compileNoulHandler(data: NoulHandlerData): Handle {
  // the contract evaluator owns the semantics (operators, band, strict comparisons)
  return (answer) => {
    const severity = handleSeverity(answer.value, data);
    return severity === null ? null : { severity };
  };
}

/**
 * The single data -> function seam for choice rules: the map indexes the score axis (0..N).
 * Findings carry no message — consumers join by rule id to the config (v1 contract).
 */
export function compileScoreHandler(data: ScoreHandlerData): Handle {
  return (answer) => {
    // jev bounds score to the criteria count, so an out-of-scale or NaN score is an impossible
    // state, not a silent null - fail loud (InternalError: the wire contract broke, not the
    // invocation), per repo convention (the contract evaluator alone would degrade to silent).
    const index = Math.round(answer.value);
    if (!Number.isInteger(index) || index < 0 || index >= data.map.length) {
      throw new InternalError(
        `score ${answer.value} is outside the criteria scale 0..${data.map.length - 1} - the classifier returned an out-of-bounds score`,
      );
    }
    // the resolver owns the read; DEFAULT (and only) read is round-to-nearest-level
    const severity = resolveScore(answer.value, answer.probabilities, answer.confidence, data);
    return severity === null ? null : { severity };
  };
}

const LEVEL_SCHEMA = Type.Union([
  Type.Literal("pass"),
  Type.Literal("warn"),
  Type.Literal("error"),
]);

const SCORE_HANDLER_SCHEMA = Type.Object(
  {
    map: Type.Array(LEVEL_SCHEMA, { minItems: 1 }),
  },
  {
    description:
      "Score handler (choice rules only): one level per criteria entry, indexed by score 0..N. Direction is expressed by the map itself (high-bad: [pass, pass, warn, error]; high-good: [error, warn, pass, pass]). The length MUST equal the criteria count and at least one level must be non-pass. A fired level's finding message defaults to that level's criteria line, prefixed by the element reference.",
  },
);

const CONDITION_SCHEMA = Type.Union(
  [
    Type.Object(
      { greater_than: Type.Number() },
      { description: "Fires when the raw value is strictly greater." },
    ),
    Type.Object(
      { less_than: Type.Number() },
      { description: "Fires when the raw value is strictly less." },
    ),
  ],
  {
    description:
      "One threshold comparison: exactly one operator. The operator IS the defect direction - greater_than fires on high readings, less_than on low ones. Within (0, 1).",
  },
);

const NOUL_HANDLER_SCHEMA = Type.Object(
  {
    warn: CONDITION_SCHEMA,
    error: Type.Optional(CONDITION_SCHEMA),
    silent_band: Type.Optional(Type.Tuple([Type.Number(), Type.Number()])),
  },
  {
    description:
      "Noul handler (noul rules only): per-threshold comparison operators declare the direction - warn is the wider region, error the strictly narrower one (same direction, ordered toward the defect: greater warn < greater error, or less warn > less error). silent_band [lo, hi] keeps raw-p readings inside it silent (must be ordered, must not cover the whole scale, must not contain a threshold value); absent = everything surfaces.",
  },
);

export const HANDLER_SCHEMA = Type.Union([SCORE_HANDLER_SCHEMA, NOUL_HANDLER_SCHEMA]);

/**
 * The handler TYPE must match the question type (score map <-> choice, operators <-> noul) and its
 * internal invariants hold. Every failure names the rule id and the exact field. A rule without a
 * handle does not compile: the schema rejects it (policy is not optional).
 */
export function compileDataHandle(
  handle: HandlerData,
  name: string,
  source: string,
  isChoice: boolean,
  criteria: readonly string[],
): Handle {
  const fail = (field: string, detail: string): never => {
    throw new SetupError(
      "CONFIG_INVALID",
      `invalid config ${source}: rule '${name}' ${field}: ${detail}`,
    );
  };
  if ("map" in handle) {
    if (!isChoice) {
      fail(
        "handle.map",
        "a score handler on a noul rule (criteria {true, false}) — noul rules take a warn/error operator handler",
      );
    }
    if (handle.map.length !== criteria.length) {
      fail(
        "handle.map",
        `map has ${handle.map.length} level(s) but the criteria has ${criteria.length}`,
      );
    }
    if (handle.map.every((level) => level === "pass")) {
      fail("handle.map", "at least one level must be non-pass");
    }
    return compileScoreHandler(handle);
  }
  if (isChoice) {
    fail("handle", "a noul handler on a choice rule — choice rules take a score handler ({ map })");
  }
  const problem = checkNoulHandler(handle);
  if (problem !== null) {
    throw new SetupError("CONFIG_INVALID", `invalid config ${source}: rule '${name}' ${problem}`);
  }
  return compileNoulHandler(handle);
}
