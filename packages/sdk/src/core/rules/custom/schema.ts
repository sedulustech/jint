/**
 * The TS-rule contract: rules authored in TypeScript, executed by jint on the embedded runtime. A
 * TS config default-exports a config object — a partial config whose rules may be declarative rules
 * or inline callback CustomRules — and every handler (target fn, classify, handle) returns data;
 * jint, never the rule, calls the classifier. The runtime validation here is the contract
 * enforcement (the editor types are DX only — the runtime does NOT typecheck).
 */

import { RULE_TARGETS } from "@jint/contract";
import {
  CAPTURE_ADDRESS_SCHEMA,
  CONDITION_SCHEMA,
  NOUL_HANDLER_SCHEMA,
  RULE_BASE_SCHEMA,
  NOUL_RULE_SCHEMA,
  readonlyList,
} from "@jint/contract/schema";
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { checkRuleScope } from "../../scope.ts";
import { SetupError, type RuleResult } from "../../types.ts";
import { checkNoulHandler } from "../handle.ts";
import { functionField, type CustomElement, type RuleContext } from "./shape.ts";

export type { CustomElement, CustomFile, ElementSelection, RuleContext } from "./shape.ts";

const QUESTION_FIELDS = {
  instructions: NOUL_RULE_SCHEMA.properties.instructions,
  criteria: NOUL_RULE_SCHEMA.properties.criteria,
};

const QUESTION_SCHEMA = Type.Object(QUESTION_FIELDS);

const SPEC_SCHEMA = Type.Object({
  ...QUESTION_FIELDS,
  state: Type.Record(Type.String(), Type.Unknown()),
});

/**
 * One compiled judgment. jint schema-validates the spec, applies per-part size backstops,
 * serializes it, and calls the provider — the rule NEVER sees the classifier. Composition is free;
 * observability (the recorded requests) is the guarantee.
 */
export interface StateSchema extends Readonly<Static<typeof SPEC_SCHEMA>> {}

const DECISION_SCHEMA = Type.Object({
  severity: Type.Union([Type.Literal("error"), Type.Literal("warn"), Type.Null()], {
    description: "Null: the result stays a classification and raises no finding.",
  }),
  message: Type.Optional(
    Type.String({
      description:
        "An instruction to the caller fixing the finding, rendered beneath the finding line.",
    }),
  ),
});

/** One policy decision, positionally paired with the rule's results: what becomes a finding. */
export interface CustomDecision extends Readonly<Static<typeof DECISION_SCHEMA>> {}

export type CustomHandleData = import("@jint/contract").NoulHandlerData;

/** The part of a state a rule composes for one element; a part with no value is left out. */
export type ComposeState = (target: CustomElement) => Readonly<Record<string, unknown>>;

const STRICT_CONDITION = Type.Union(
  CONDITION_SCHEMA.anyOf.map((c) => Type.Object(c.properties, { additionalProperties: false })),
);

// The JSON tier's noul handler, with no other key: a { warn, map } hybrid is rejected at load.
// checkNoulHandler names a handle that has neither warn nor error.
const STRICT_HANDLE_SCHEMA = Type.Object(
  {
    ...NOUL_HANDLER_SCHEMA.properties,
    warn: Type.Optional(STRICT_CONDITION),
    error: Type.Optional(STRICT_CONDITION),
  },
  { additionalProperties: false },
);

const roleLiterals = RULE_TARGETS.map((role) => Type.Literal(role));

const TARGET_FUNCTION_SCHEMA = functionField<
  (elements: readonly CustomElement[]) => readonly CustomElement[]
>({
  description: "Chooses the elements to judge. It is given every element of the run.",
  display: "(elements) => elements",
});

const HANDLE_FUNCTION_SCHEMA = functionField<
  (results: readonly RuleResult[], ctx: RuleContext) => readonly CustomDecision[]
>({
  description:
    "Decides the severity of each result, after every element is classified. A null severity raises no finding.",
  display: "(results, ctx) => decisions",
});

const STATE_FUNCTION_SCHEMA = functionField<ComposeState>({
  description:
    "Composes what the model reads about one element. Each key is a part, and a part with no value is left out. It replaces the element's own source, and a function that throws fails that element only.",
  display: "(target) => object",
});

const CLASSIFY_FUNCTION_SCHEMA = functionField<(target: CustomElement) => StateSchema>({
  description:
    "Composes the question too, when it changes from one element to the next. A rule has state or classify, never both.",
  display: "(target) => { instructions, criteria, state }",
});

/**
 * The fields only a TypeScript config can hold. The target and handle fields add a function form to
 * the data form the declarative rule takes.
 */
export const FUNCTION_FIELD_SCHEMAS = {
  state: STATE_FUNCTION_SCHEMA,
  classify: CLASSIFY_FUNCTION_SCHEMA,
  target: TARGET_FUNCTION_SCHEMA,
  handle: HANDLE_FUNCTION_SCHEMA,
};

const CUSTOM_BASE_SCHEMA = Type.Object({
  name: Type.String({
    minLength: 1,
    description: RULE_BASE_SCHEMA.properties.name.description,
  }),
  kind: NOUL_RULE_SCHEMA.properties.kind,
  target: Type.Union([
    ...roleLiterals,
    CAPTURE_ADDRESS_SCHEMA,
    readonlyList(Type.Union([...roleLiterals, CAPTURE_ADDRESS_SCHEMA]), {
      minItems: 1,
    }),
    TARGET_FUNCTION_SCHEMA,
  ]),
  include: RULE_BASE_SCHEMA.properties.include,
  exclude: RULE_BASE_SCHEMA.properties.exclude,
  handle: Type.Union([Type.Unsafe<CustomHandleData>(STRICT_HANDLE_SCHEMA), HANDLE_FUNCTION_SCHEMA]),
});

const COMPOSED_SCHEMA = Type.Object({
  ...QUESTION_FIELDS,
  state: STATE_FUNCTION_SCHEMA,
  classify: Type.Optional(Type.Undefined()),
});

const CLASSIFIED_SCHEMA = Type.Object({
  classify: CLASSIFY_FUNCTION_SCHEMA,
  state: Type.Optional(Type.Undefined()),
  instructions: Type.Optional(Type.Undefined()),
  criteria: Type.Optional(Type.Undefined()),
});

/** A question that is the same for every element, and the state that differs. */
export interface ComposedQuestion extends Readonly<Static<typeof COMPOSED_SCHEMA>> {}

/** A question composed per element, its state included. */
export interface ClassifiedQuestion extends Readonly<Static<typeof CLASSIFIED_SCHEMA>> {}

/**
 * A custom rule: name, target (the REQUEST), the question it asks of each element, and its one
 * policy, handle (required — data or a function; a classification-only rule silences itself with ()
 * => []). The question is asked once for each resolved target. noul-only in v1 — the other kinds
 * are rejected at load.
 */
export type CustomRule = CustomRuleBase & (ComposedQuestion | ClassifiedQuestion);

export interface CustomRuleBase extends Readonly<Static<typeof CUSTOM_BASE_SCHEMA>> {}

/**
 * A TS config's shape: the same keys a top-level config takes (the config boundary validates it),
 * minus the custom-rules key. Entries in rules compose last-wins by name: declarative specs (the
 * compiled-in defaults and their spread-and-overrides) and inline callback CustomRules.
 */
export interface TsConfig {
  readonly $schema?: string;
  readonly input?: string;
  /**
   * The rules, and the default scope every rule follows (a rule's own include/exclude overrides
   * it).
   */
  readonly rules?: {
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
    readonly use?: ReadonlyArray<string | CustomRule | ({ readonly name: string } & object)>;
  };
  readonly concurrency?: number;
  readonly timeout?: number;
  readonly maxInputTokens?: number;
  readonly charsPerToken?: number;
}

/**
 * The runtime does NOT typecheck, so the spec is validated here: a violation throws a plain
 * contract-violation Error, which the engine catches per call and streams as a named per-unit
 * failure (run-time, non-fatal).
 */
export function validateStateSpec(spec: unknown, ruleName: string, element: string): StateSchema {
  if (!Value.Check(SPEC_SCHEMA, spec)) {
    const messages = [...Value.Errors(SPEC_SCHEMA, spec)]
      .map((err) => (err.path === "" ? "/" : err.path) + " " + err.message)
      .join("; ");
    throw new Error(
      'custom rule "' +
        ruleName +
        '" returned an invalid state spec for ' +
        element +
        ": " +
        messages,
    );
  }
  return spec as StateSchema;
}

/** Validates one callback-handle decision; throws a contract-violation Error (see above). */
export function validateDecision(
  decision: unknown,
  ruleName: string,
  index: number,
): CustomDecision {
  if (!Value.Check(DECISION_SCHEMA, decision)) {
    throw new Error(
      'custom rule "' +
        ruleName +
        '" handle returned an invalid decision at index ' +
        String(index) +
        ' — expected { severity: "error" | "warn" | null, message? }',
    );
  }
  return decision as CustomDecision;
}

/** The targets a rule names, which a target function has none of. */
export function targetNamesOf({ target }: Pick<CustomRule, "target">): readonly string[] {
  if (typeof target === "function") return [];
  return typeof target === "string" ? [target] : target;
}

const isFunction = (schema: TSchema, value: unknown): boolean => Value.Check(schema, value);

function checkQuestion(rule: Record<string, unknown>): string | null {
  if (isFunction(FUNCTION_FIELD_SCHEMAS.classify, rule.classify)) {
    const extra = ["state", "instructions", "criteria"].find((key) => rule[key] !== undefined);
    return extra === undefined
      ? null
      : `${extra} and classify - classify returns all of the question`;
  }
  if (!isFunction(FUNCTION_FIELD_SCHEMAS.state, rule.state)) {
    return "missing state(target) or classify(target)";
  }
  return Value.Check(QUESTION_SCHEMA, rule)
    ? null
    : "state needs instructions and criteria { true, false } beside it";
}

/** A callback rule asks its question through a function; a declarative rule has none. */
export function isCustomRule(rule: object): rule is CustomRule {
  return (
    ("classify" in rule && isFunction(FUNCTION_FIELD_SCHEMAS.classify, rule.classify)) ||
    ("state" in rule && isFunction(FUNCTION_FIELD_SCHEMAS.state, rule.state))
  );
}

export function validateCustomRule(rule: unknown, file: string): CustomRule {
  const fail = (message: string): never => {
    throw new SetupError("RULE_INVALID", "custom rule in " + file + ": " + message);
  };
  if (typeof rule !== "object" || rule === null) fail("rules[] entry is not an object");
  const r = rule as Record<string, unknown>;
  if (!Value.Check(CUSTOM_BASE_SCHEMA.properties.name, r.name)) {
    fail('rule has no "name" (non-empty string)');
  }
  const name = r.name as string;
  if (r.kind !== undefined && !Value.Check(CUSTOM_BASE_SCHEMA.properties.kind, r.kind)) {
    fail(
      '"' +
        name +
        '": kind "' +
        String(r.kind) +
        '" is not supported in custom rules yet (noul only)',
    );
  }
  if (!Value.Check(CUSTOM_BASE_SCHEMA.properties.target, r.target)) {
    fail(
      '"' +
        name +
        '": invalid target — expected one of ' +
        RULE_TARGETS.join(", ") +
        ", a non-empty list of them, or an (elements) => Element[] function",
    );
  }
  const questionProblem = checkQuestion(r);
  if (questionProblem !== null) fail('"' + name + '": ' + questionProblem);
  // Scoping reuses the shared checker: bad shapes and field-naming messages cannot drift between tiers.
  const scopeProblem = checkRuleScope({
    include: r.include as readonly string[] | undefined,
    exclude: r.exclude as readonly string[] | undefined,
  });
  if (scopeProblem !== null) fail('"' + name + '": ' + scopeProblem);
  // handle is REQUIRED: one union field, so "both" encodings cannot be expressed; the callback
  // arm's deeper shape is the engine's run-time contract.
  const handle = r.handle;
  if (handle === undefined) {
    fail(
      '"' +
        name +
        '": handle is required — every custom rule has exactly one policy (data or a (results, ctx) => decisions function)',
    );
  }
  if (!Value.Check(CUSTOM_BASE_SCHEMA.properties.handle, handle)) {
    fail(
      '"' +
        name +
        '": handle must be the typed noul handler { warn?, error?, silent_band? } (at least one of warn/error, each { greater_than | less_than, message? }) or a (results, ctx) => decisions function',
    );
  } else if (!isFunction(HANDLE_FUNCTION_SCHEMA, handle)) {
    const h = handle as CustomHandleData;
    // custom rules are noul-only, so the question type is fixed: a score map is a tier-mismatch,
    // rejected here exactly as the declarative tier rejects it.
    if ("map" in h) fail('"' + name + '": handle.map: a score handler on a noul rule');
    const problem = checkNoulHandler(h);
    if (problem !== null) fail('"' + name + '": ' + problem);
  }
  return r as unknown as CustomRule;
}

/**
 * Passthrough by design: the author's literal type survives, so declarative entries and callback
 * rules compose alike.
 */
export function defineConfig(config: TsConfig): TsConfig {
  const fail = (message: string): never => {
    throw new SetupError("RULE_INVALID", "defineConfig: " + message);
  };
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    fail("takes one config object");
  }
  for (const key of Object.keys(config)) {
    if (key === "include" || key === "exclude") {
      fail(
        '"' +
          key +
          '" moved under rules: write rules: { ' +
          key +
          ": [...], use: [...] } - the default scope of every rule; a rule's own include/exclude still overrides it",
      );
    }
    if (!CONFIG_KEYS.has(key)) {
      fail(
        '"' +
          key +
          '" is not allowed in a TS config — a TS config takes the same keys a config file takes, minus customRules',
      );
    }
  }
  const rules = config.rules;
  if (Array.isArray(rules)) fail('"rules" is now an object: write rules: { use: [...] }');
  if (rules !== undefined && (typeof rules !== "object" || rules === null)) {
    fail('"rules" must be an object: { include?, exclude?, use? }');
  }
  if (rules?.use !== undefined && !Array.isArray(rules.use)) fail('"rules.use" must be an array');
  return config;
}

const CONFIG_KEYS: ReadonlySet<string> = new Set([
  "$schema",
  "input",
  "rules",
  "concurrency",
  "timeout",
  "maxInputTokens",
  "charsPerToken",
]);
