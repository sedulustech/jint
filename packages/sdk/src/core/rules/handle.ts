/**
 * The typed handler taxonomy. The question type decides which handler is valid:
 *
 * - ScoreHandler (score questions, graded criteria levels): { map } — one level per criterion,
 *   direction expressed by the map itself (high-bad: ["pass","pass","warn","error"]; high-good:
 *   ["error","warn","pass","pass"]).
 * - ChoiceHandler (choice questions, named options): { choices } — one tier per option label; the
 *   selected option's tier is the verdict.
 * - NoulHandler (noul questions, the claim probability P(true)): { warn?, error?, silent_band? }, at
 *   least one tier declared. Each tier carries one comparison operator on the raw value (the
 *   operator IS the defect pole). With both tiers, error is strictly narrower than warn.
 *   silent_band absent = everything surfaces (explicit, no engine default).
 *
 * Handlers are data, never code; compileHandle() is the only place data becomes function; every
 * other consumer — schema, defaults, loader — stays in data.
 */

import { checkChoiceHandler, checkNoulHandler, type HandlerData } from "@jint/contract";
import { Type } from "@sinclair/typebox";
import { InternalError, SetupError, type HandleOutcome, type RuleKind } from "../types.ts";
// The taxonomy and the pure evaluation live in the contract package (one definition, shared with
// the measurement UI); the engine owns only the compiled seams (handle data -> function).
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
 * firing side, so a reading exactly at a threshold stays silent. A silent_band hit suppresses
 * before any threshold is consulted. The contract evaluator owns these semantics.
 */
export function compileNoulHandler(data: NoulHandlerData): Handle {
  // the contract evaluator owns the semantics (operators, band, strict comparisons)
  return (answer) => handleTier(answer.value, data);
}

/**
 * The single data -> function seam for score rules: the map indexes the score axis (0..N). The
 * fired tier's message (if the author wrote one) rides the outcome as the finding's note.
 */
export function compileScoreHandler(data: ScoreHandlerData): Handle {
  return (answer) => {
    // the provider bounds score to the criteria count, so an out-of-scale or NaN score is an impossible
    // state, not a silent null - fail loud (InternalError: the wire contract broke, not the
    // invocation), per repo convention (the contract evaluator alone would degrade to silent).
    const index = Math.round(answer.value);
    if (!Number.isInteger(index) || index < 0 || index >= data.map.length) {
      throw new InternalError(
        `score ${answer.value} is outside the criteria scale 0..${data.map.length - 1} - the classifier returned an out-of-bounds score`,
      );
    }
    // the resolver owns the read; DEFAULT (and only) read is round-to-nearest-level; the fired
    // tier's author message (if any) rides the outcome as the finding's note
    return resolveScoreTier(answer.value, answer.probabilities, data);
  };
}

/**
 * The single data -> function seam for choice rules: the selected option's label picks its tier. A
 * missing or unknown label is an impossible state (the request named every option) - fail loud,
 * like an out-of-scale score.
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

const LEVEL_SCHEMA = Type.Union([
  Type.Literal("pass"),
  Type.Literal("warn"),
  Type.Literal("error"),
]);

const SCORE_TIER_SCHEMA = Type.Union([
  LEVEL_SCHEMA,
  Type.Object({
    level: LEVEL_SCHEMA,
    message: Type.Optional(
      Type.String({
        description: "The rule author's feedback; the finding's note when this tier fires.",
      }),
    ),
  }),
]);

const SCORE_HANDLER_SCHEMA = Type.Object(
  {
    map: Type.Array(SCORE_TIER_SCHEMA, { minItems: 1 }),
  },
  {
    description:
      "Score handler (score rules only): one level per criteria entry, indexed by score 0..N. Direction is expressed by the map itself (high-bad: [pass, pass, warn, error]; high-good: [error, warn, pass, pass]). The length MUST equal the criteria count and at least one level must be non-pass. An optional per-tier message (author feedback) becomes the finding's note when the tier fires; absent = a bare finding.",
  },
);

const CHOICE_HANDLER_SCHEMA = Type.Object(
  {
    choices: Type.Record(Type.String(), SCORE_TIER_SCHEMA),
    undecided: Type.Optional(
      Type.Object({
        margin: Type.Number(),
        level: LEVEL_SCHEMA,
        message: Type.Optional(Type.String()),
      }),
    ),
  },
  {
    description:
      "Choice handler (choice rules only): one tier per option label, keyed by the label. The option probabilities are summed per tier; the tier with the most probability is the verdict, and its most probable option's message becomes the finding's note. Options are unordered, nothing is averaged. The labels MUST equal the criteria labels and at least one tier must be non-pass. Optional undecided { margin, level, message? }: when the top tier's probability leads the runner-up tier's by less than `margin` (between 0 and 1), this tier fires instead - an undecided reading the rule acts on like any other tier.",
  },
);

const CONDITION_SCHEMA = Type.Union(
  [
    Type.Object(
      {
        greater_than: Type.Number(),
        message: Type.Optional(
          Type.String({
            description: "The rule author's feedback; the finding's note when this tier fires.",
          }),
        ),
      },
      { description: "Fires when the raw value is strictly greater." },
    ),
    Type.Object(
      {
        less_than: Type.Number(),
        message: Type.Optional(
          Type.String({
            description: "The rule author's feedback; the finding's note when this tier fires.",
          }),
        ),
      },
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
    warn: Type.Optional(CONDITION_SCHEMA),
    error: Type.Optional(CONDITION_SCHEMA),
    silent_band: Type.Optional(Type.Tuple([Type.Number(), Type.Number()])),
  },
  {
    description:
      "Noul handler (noul rules only): per-threshold comparison operators declare the direction. Declare at least one tier - warn, error, or both; a handle with neither is rejected. An error-only handle fires error past its threshold and passes otherwise. When both tiers are present, warn is the wider region and error the strictly narrower one (same direction, ordered toward the defect: greater warn < greater error, or less warn > less error). silent_band [lo, hi] keeps raw-p readings inside it silent (must be ordered, must not cover the whole scale, must not contain any declared threshold value); absent = everything surfaces.",
  },
);

export const HANDLER_SCHEMA = Type.Union([
  SCORE_HANDLER_SCHEMA,
  CHOICE_HANDLER_SCHEMA,
  NOUL_HANDLER_SCHEMA,
]);

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
