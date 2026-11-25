/**
 * The rule schemas: the one definition of every declarative rule field. The types a rule is written
 * against derive from these, and the config boundary, the editor schema and the reference read
 * them. Run-time dependencies live behind this entry; the main entry stays type-only.
 */

import { Type, type SchemaOptions, type Static, type TSchema } from "@sinclair/typebox";
import { RULE_TARGETS, type QualifiedRuleTarget } from "./handlers.ts";

export const LEVEL_SCHEMA = Type.Union(
  [Type.Literal("pass"), Type.Literal("warn"), Type.Literal("error")],
  { description: "The severity of a finding: pass raises none." },
);

const TIER_SCHEMA = Type.Object({
  level: LEVEL_SCHEMA,
  message: Type.Optional(
    Type.String({
      description: "The rule author's feedback; the finding's note when this tier fires.",
    }),
  ),
});

export const SCORE_TIER_SCHEMA = Type.Union([LEVEL_SCHEMA, TIER_SCHEMA]);

export const SCORE_HANDLER_SCHEMA = Type.Object(
  {
    map: Type.Array(SCORE_TIER_SCHEMA, {
      minItems: 1,
      description: "One tier for each score level, in the order of the criteria.",
    }),
  },
  {
    description:
      "Score handler (score rules only): one level per criteria entry, indexed by score 0..N. Direction is expressed by the map itself (high-bad: [pass, pass, warn, error]; high-good: [error, warn, pass, pass]). The length MUST equal the criteria count and at least one level must be non-pass. An optional per-tier message (author feedback) becomes the finding's note when the tier fires; absent = a bare finding.",
  },
);

export const CHOICE_HANDLER_SCHEMA = Type.Object(
  {
    choices: Type.Record(Type.String(), SCORE_TIER_SCHEMA, {
      description: "One tier for each option, keyed by the option label.",
    }),
    undecided: Type.Optional(
      Type.Object(
        {
          margin: Type.Number({
            description:
              "The gap between the two likeliest options under which the value is undecided.",
          }),
          level: LEVEL_SCHEMA,
          message: Type.Optional(
            Type.String({
              description: "The note on the finding of an undecided value.",
            }),
          ),
        },
        {
          description: "The tier of a value with no clear winner among the options.",
        },
      ),
    ),
  },
  {
    description:
      "Choice handler (choice rules only): one tier per option label, keyed by the label. The option probabilities are summed per tier; the tier with the most probability is the verdict, and its most probable option's message becomes the finding's note. Options are unordered, nothing is averaged. The labels MUST equal the criteria labels and at least one tier must be non-pass. Optional undecided { margin, level, message? }: when the top tier's probability leads the runner-up tier's by less than `margin` (between 0 and 1), this tier fires instead - an undecided classification the rule acts on like any other tier.",
  },
);

export interface ThresholdCondition extends Partial<
  Static<typeof GREATER_THAN_SCHEMA> & Static<typeof LESS_THAN_SCHEMA>
> {}

const GREATER_THAN_SCHEMA = Type.Object(
  {
    greater_than: Type.Number({
      description: "The threshold. A value above it fires.",
    }),
    message: Type.Optional(
      Type.String({
        description: "The rule author's feedback; the finding's note when this tier fires.",
      }),
    ),
  },
  { description: "Fires when the raw value is strictly greater." },
);

const LESS_THAN_SCHEMA = Type.Object(
  {
    less_than: Type.Number({
      description: "The threshold. A value below it fires.",
    }),
    message: Type.Optional(
      Type.String({
        description: "The rule author's feedback; the finding's note when this tier fires.",
      }),
    ),
  },
  { description: "Fires when the raw value is strictly less." },
);

export const CONDITION_SCHEMA = Type.Union([GREATER_THAN_SCHEMA, LESS_THAN_SCHEMA], {
  description:
    "One threshold comparison: exactly one operator. The operator IS the defect direction - greater_than fires on high values, less_than on low ones. Within (0, 1).",
});

export const NOUL_HANDLER_SCHEMA = Type.Object(
  {
    warn: Type.Optional(Type.Unsafe<ThresholdCondition>(CONDITION_SCHEMA)),
    error: Type.Optional(Type.Unsafe<ThresholdCondition>(CONDITION_SCHEMA)),
    silent_band: Type.Optional(
      Type.Tuple([Type.Number(), Type.Number()], {
        description: "A [low, high] range of values that raises no finding.",
      }),
    ),
  },
  {
    description:
      "Noul handler (noul rules only): per-threshold comparison operators declare the direction. Declare at least one tier - warn, error, or both; a handle with neither is rejected. An error-only handle fires error past its threshold and passes otherwise. When both tiers are present, warn is the wider region and error the strictly narrower one (same direction, ordered toward the defect: greater warn < greater error, or less warn > less error). silent_band [lo, hi] keeps raw-p classifications inside it silent (must be ordered, must not cover the whole scale, must not contain any declared threshold value); absent = everything surfaces.",
  },
);

export const HANDLER_SCHEMA = Type.Union(
  [SCORE_HANDLER_SCHEMA, CHOICE_HANDLER_SCHEMA, NOUL_HANDLER_SCHEMA],
  {
    description: "How a value becomes a finding. The shape follows the kind of the rule.",
  },
);

export type HandlerLevel = Static<typeof LEVEL_SCHEMA>;
export interface ScoreTier extends Static<typeof TIER_SCHEMA> {}
export interface ScoreHandlerData extends Static<typeof SCORE_HANDLER_SCHEMA> {}
export interface ChoiceHandlerData extends Static<typeof CHOICE_HANDLER_SCHEMA> {}
export interface NoulHandlerData extends Static<typeof NOUL_HANDLER_SCHEMA> {}
export type HandlerData = Static<typeof HANDLER_SCHEMA>;

const targetLiterals = RULE_TARGETS.map((target) => Type.Literal(target));

export const CAPTURE_NAME = "[A-Za-z_][A-Za-z0-9_-]*(?:\\.[A-Za-z0-9_-]+)*";

export const CAPTURE_ADDRESS = /^([a-z][a-z0-9_-]*):([a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)*)$/;

export const CAPTURE_ADDRESS_SCHEMA = Type.Unsafe<QualifiedRuleTarget>(
  Type.String({
    pattern: CAPTURE_ADDRESS.source,
    description:
      "A qualified capture address {grammar}:{capture} (e.g. markdown:h2): targets the named grammar's own capture. Unknown grammar or capture is a setup error.",
  }),
);

/** An array the author may write as a readonly one. */
export function readonlyList<T extends TSchema>(item: T, options: SchemaOptions = {}) {
  return Type.Unsafe<readonly Static<T>[]>(Type.Array(item, options));
}

export const TARGET_SCHEMA = Type.Union(
  [
    ...targetLiterals,
    CAPTURE_ADDRESS_SCHEMA,
    readonlyList(Type.Union([...targetLiterals, CAPTURE_ADDRESS_SCHEMA])),
  ],
  {
    description:
      "What the rule measures: files, a kind of element, or a capture. A list measures each.",
  },
);

/** The fields every rule has, whatever its kind. */
export const RULE_BASE_SCHEMA = Type.Object({
  name: Type.String({
    description:
      "The rule id: findings join back to it. Two entries with one name are a config error unless the later one sets override.",
  }),
  include: Type.Optional(
    readonlyList(Type.String(), {
      description: "Globs of the files this rule reads. It replaces the run include for this rule.",
    }),
  ),
  exclude: Type.Optional(
    readonlyList(Type.String(), {
      description: "Globs of the files this rule skips. Exclude always wins over include.",
    }),
  ),
  override: Type.Optional(
    Type.Boolean({
      description:
        "true: this entry replaces an earlier entry of the same name. Without it a repeated name is a config error, and with it an entry that replaces nothing is too.",
    }),
  ),
});

const INCLUDE_PATH_SCHEMA = Type.Optional(
  Type.Boolean({
    description:
      "true: the model is handed the file's path with the source. Default false: only the source is sent, so the same code reads the same wherever the file sits. Set it for a rule whose claim is about the path itself.",
  }),
);

const { name, include, exclude, override } = RULE_BASE_SCHEMA.properties;

// kind stays optional in the noul rule: noul is the default, and the loader fills it. The question
// and the handle are both required, so a rule never classifies under an invented prompt.
export const NOUL_RULE_SCHEMA = Type.Object({
  name,
  kind: Type.Optional(
    Type.Literal("noul", {
      description: "The question type. Absent means noul.",
    }),
  ),
  instructions: Type.String({
    description:
      "The yes/no question the model answers, specific to the rule's claim. Required - a generic fallback question would silently recalibrate every classification.",
  }),
  criteria: Type.Object(
    {
      true: Type.String({ description: "The condition for yes." }),
      false: Type.String({ description: "The condition for no." }),
    },
    {
      description:
        "The two-sided contract: true names the exact observable condition for yes, false for no. The defect side decides the handle direction.",
    },
  ),
  target: TARGET_SCHEMA,
  handle: Type.Unsafe<Static<typeof NOUL_HANDLER_SCHEMA>>(HANDLER_SCHEMA),
  include,
  exclude,
  includePath: INCLUDE_PATH_SCHEMA,
  override,
});

export const SCORE_RULE_SCHEMA = Type.Object({
  name,
  kind: Type.Literal("score", {
    description: "The question type: a rating on the criteria scale.",
  }),
  criteria: readonlyList(Type.String(), {
    minItems: 2,
    description: "One description for each score level, from level 0 up.",
  }),
  instructions: Type.String({ description: "The question the model answers." }),
  target: TARGET_SCHEMA,
  handle: Type.Unsafe<Static<typeof SCORE_HANDLER_SCHEMA>>(HANDLER_SCHEMA),
  include,
  exclude,
  includePath: INCLUDE_PATH_SCHEMA,
  override,
});

export const CHOICE_RULE_SCHEMA = Type.Object({
  name,
  kind: Type.Literal("choice", {
    description: "The question type: one option out of several.",
  }),
  criteria: Type.Record(Type.String(), Type.String(), {
    minProperties: 2,
    description:
      "The named options: option label -> what selecting it means. Unordered; the model selects one.",
  }),
  instructions: Type.String({ description: "The question the model answers." }),
  target: TARGET_SCHEMA,
  handle: Type.Unsafe<Static<typeof CHOICE_HANDLER_SCHEMA>>(HANDLER_SCHEMA),
  include,
  exclude,
  includePath: INCLUDE_PATH_SCHEMA,
  override,
});

export const RULE_SCHEMA = Type.Union([NOUL_RULE_SCHEMA, SCORE_RULE_SCHEMA, CHOICE_RULE_SCHEMA]);

export interface NoulRuleSchema extends Readonly<Static<typeof NOUL_RULE_SCHEMA>> {}
export interface ScoreRuleSchema extends Readonly<Static<typeof SCORE_RULE_SCHEMA>> {}
export interface ChoiceRuleSchema extends Readonly<Static<typeof CHOICE_RULE_SCHEMA>> {}
/** A declarative rule: exactly one of the three kinds. */
export type RuleSchema = NoulRuleSchema | ScoreRuleSchema | ChoiceRuleSchema;
