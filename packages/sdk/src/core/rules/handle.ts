/**
 * The typed handler taxonomy. The question type decides which handler is valid:
 *
 * - ScoreHandler (score questions, graded criteria levels): { map } — one level per criterion,
 *   direction expressed by the map itself (high-bad: ["pass","pass","warn","error"]; high-good:
 *   ["error","warn","pass","pass"]).
 * - ChoiceHandler (choice questions, named options): { choices } — one tier per option label.
 * - NoulHandler (noul questions, the claim probability P(true)): { warn?, error?, silent_band? }, at
 *   least one tier declared. Each tier carries one comparison operator on the raw value (the
 *   operator IS the defect pole). With both tiers, error is strictly narrower than warn.
 *   silent_band absent = everything surfaces (explicit, no engine default).
 *
 * Handlers are data, never code.
 */

import { checkChoiceHandler, checkNoulHandler, type HandlerData } from "@jint/contract";
import { InternalError, SetupError, type HandleOutcome, type RuleKind } from "../types.ts";
// The taxonomy and the pure evaluation live in the contract package (one definition, shared with
// the classification UI); the engine owns only the compiled seams (handle data -> function).
export {
  checkChoiceHandler,
  checkCondition,
  checkNoulHandler,
  conditionFires,
  handleSeverity,
  isChoiceHandler,
  isScoreHandler,
  type ChoiceHandlerData,
  type HandlerData,
  type HandlerLevel,
  type NoulHandlerData,
  type ScoreHandlerData,
  type ThresholdCondition,
} from "@jint/contract";

import {
  handleTier,
  resolveScoreTier,
  type ChoiceHandlerData,
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
 * firing side, so a value exactly at a threshold stays silent. A silent_band hit suppresses before
 * any threshold is consulted. The contract evaluator owns these semantics.
 */
export function compileNoulHandler(noulHandler: NoulHandlerData): Handle {
  return function handleNoulAnswer(classifiedAnswer: ClassifiedAnswer) {
    return handleTier(classifiedAnswer.value, noulHandler);
  };
}

export function compileScoreHandler(scoreHandler: ScoreHandlerData): Handle {
  return (answer) => {
    const scoreIndex = Math.round(answer.value);
    if (!Number.isInteger(scoreIndex) || scoreIndex < 0 || scoreIndex >= scoreHandler.map.length) {
      throw new InternalError(
        `score ${answer.value} is outside the criteria scale 0..${scoreHandler.map.length - 1} - the classifier returned an out-of-bounds score`,
      );
    }
    return resolveScoreTier(answer.value, answer.probabilities, scoreHandler);
  };
}

/**
 * The single data -> function seam for choice rules. A missing or unknown label is an impossible
 * state (the request named every option) - fail loud, like an out-of-scale score.
 */
export function compileChoiceHandler(data: ChoiceHandlerData): Handle {
  return (answer) => {
    if (answer.choice === undefined || !(answer.choice in data.choices)) {
      throw new InternalError(
        `choice ${JSON.stringify(answer.choice)} is not one of the options ${Object.keys(data.choices).join(", ")} - the classifier returned an unknown option`,
      );
    }
    return handleTier(answer.value, data, answer.choice, answer.probabilities);
  };
}

/**
 * The handler TYPE must match the question type (score map <-> score, choices <-> choice, operators
 * <-> noul) and its internal invariants hold. Every failure names the rule id and the exact field.
 * A rule without a handle does not compile: the schema rejects it (policy is not optional).
 *
 * Criteria: the score levels or the choice option labels; unused for noul.
 */
export function compileDataHandle(
  handle: HandlerData,
  name: string,
  source: string,
  kind: RuleKind,
  criteria: readonly string[],
): Handle {
  const fail = (field: string, detail: string): never => {
    throw new SetupError(
      "CONFIG_INVALID",
      `invalid config ${source}: rule '${name}' ${field}: ${detail}`,
    );
  };
  if ("map" in handle) {
    if (kind !== "score") {
      fail("handle.map", `a score handler on a ${kind} rule — ${HANDLE_FOR[kind]}`);
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
  if ("choices" in handle) {
    if (kind !== "choice") {
      fail("handle.choices", `a choice handler on a ${kind} rule — ${HANDLE_FOR[kind]}`);
    }
    const problem = checkChoiceHandler(handle, criteria);
    if (problem !== null) {
      throw new SetupError("CONFIG_INVALID", `invalid config ${source}: rule '${name}' ${problem}`);
    }
    return compileChoiceHandler(handle);
  }
  if (kind !== "noul") {
    fail("handle", `a noul handler on a ${kind} rule — ${HANDLE_FOR[kind]}`);
  }
  const problem = checkNoulHandler(handle);
  if (problem !== null) {
    throw new SetupError("CONFIG_INVALID", `invalid config ${source}: rule '${name}' ${problem}`);
  }
  return compileNoulHandler(handle);
}

/** The handle each kind takes, named in a kind/handle mismatch error. */
const HANDLE_FOR: Record<RuleKind, string> = {
  noul: "noul rules take a warn and/or error operator handler",
  score: "score rules take a score handler ({ map })",
  choice: "choice rules take a choice handler ({ choices })",
};
