/**
 * The TS-rule contract (tmp/designs/rules-context/01..04): rules authored in TypeScript, executed
 * by jint on the embedded runtime. A TS config default-exports defineConfig({ ... }) — a partial
 * config whose rules may be declarative rules or inline callback CustomRules — and every handler
 * (target fn, classify, handleClassification) returns data; jint, never the rule, calls the
 * classifier. The runtime validation here is the contract enforcement (sdk.d.ts is editor DX only —
 * the runtime does NOT typecheck).
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { checkRuleScope } from "../../scope.ts";
import { SetupError, type RuleResult, type RuleTarget } from "../../types.ts";
import { checkNoulHandler } from "../handle.ts";

/**
 * The element a rule sees: identity, role, source, span, and its parent (hierarchy rides on the
 * element).
 */
export interface CustomElement {
  /** Stable positional label ("d0", "c2", "i0"). */
  readonly id: string;
  /** The file this element belongs to (identity + wire naming). */
  readonly path: string;
  readonly role: "function" | "type" | "binding" | "import" | "comment";
  readonly source: string;
  readonly span: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
    readonly startByte: number;
    readonly endByte: number;
  };
  /** The comment node(s) consumed into this element's leading run (target grammar: "comments"). */
  readonly attachedComment?: readonly string[];
  /** The enclosing element, when this element sits inside one; null at the top level. */
  readonly parent: CustomElement | null;
}

/** The rule's environment, assembled by the engine after target resolution. */
export interface RuleContext {
  /** The resolved elements for this rule — the request's result, aligned with results. */
  readonly targets: readonly CustomElement[];
}

/**
 * One compiled judgment: the question text, the criteria, and the freely composed state the model
 * judges. jint schema-validates the spec, applies per-part size backstops, serializes it, and calls
 * jev — the rule NEVER sees the classifier. Composition is free; observability (the wire dumps) is
 * the guarantee.
 */
export interface StateSchema {
  readonly instructions: string;
  readonly criteria: { readonly true: string; readonly false: string };
  readonly state: Record<string, unknown>;
}

/** The declarative policy (data tier, same typed shape as JSON noul rules; exactly one per rule). */
// The declarative noul handle for custom rules: the contract's per-threshold operator form.
export type CustomHandleData = import("@jint/contract").NoulHandlerData;

/** One policy decision, aligned by index with ctx.targets: what becomes a finding. */
export interface CustomDecision {
  /** Null = silent (measurement only, no finding). */
  readonly severity: "error" | "warn" | null;
  /** Optional extra structured data, attached to the finding (schema-validated). */
  readonly data?: Record<string, unknown>;
}

/**
 * A custom rule: name, target (the REQUEST), the per-element state-schema compiler, and exactly one
 * policy (declarative handle or the callback form). classify returns ONE spec for self; jint fans
 * it out across ctx.targets. noul-only in v1 — choice/score kinds are rejected at load.
 */
export interface CustomRule {
  readonly name: string;
  readonly kind?: "noul";
  readonly target:
    | "functions"
    | "definitions"
    | "comments"
    | "imports"
    | readonly string[]
    | ((elements: readonly CustomElement[]) => readonly CustomElement[]);
  /** Per resolved target: the state spec for self. Returns data, never calls the classifier. */
  readonly classify: (self: CustomElement, ctx: RuleContext) => StateSchema;
  /** Per-rule scoping (issue 008): glob list; absent = the rule applies to all paths. */
  readonly include?: readonly string[];
  /** Per-rule scoping: glob list; ALWAYS wins over include. */
  readonly exclude?: readonly string[];
  /** Policy, data form: the typed noul handler (per-threshold comparison operators). */
  readonly handle?: CustomHandleData;
  /**
   * Policy, callback form: called ONCE after all classifications; results[i] <-> ctx.targets[i].
   * Returns one decision per result, aligned by index.
   */
  readonly handleClassification?: (
    results: readonly RuleResult[],
    ctx: RuleContext,
  ) => readonly CustomDecision[];
}

/**
 * A TS config's shape: the same keys a top-level config takes (the config boundary validates it —
 * CONFIG_SCHEMA), minus `customRules`. Entries in `rules` compose last-wins by name: declarative
 * specs (the jint:defaults exports and their spread-and-overrides) and inline callback
 * CustomRules.
 */
export interface TsConfig {
  readonly $schema?: string;
  readonly input?: string;
  readonly inputType?: "file" | "dir";
  readonly rules?: ReadonlyArray<string | CustomRule | ({ readonly name: string } & object)>;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly disable?: readonly string[];
  readonly apiKey?: string;
  readonly concurrency?: number;
  readonly timeout?: number;
}

/** The element roles a custom rule may target in v1 (unit-level targets stay JSON-tier). */
export const CUSTOM_TARGET_ROLES: readonly RuleTarget[] = [
  "functions",
  "definitions",
  "comments",
  "imports",
];

const HANDLE_SCHEMA = Type.Object(
  {
    warn: Type.Union([
      Type.Object({ greater_than: Type.Number() }, { additionalProperties: false }),
      Type.Object({ less_than: Type.Number() }, { additionalProperties: false }),
    ]),
    error: Type.Optional(
      Type.Union([
        Type.Object({ greater_than: Type.Number() }, { additionalProperties: false }),
        Type.Object({ less_than: Type.Number() }, { additionalProperties: false }),
      ]),
    ),
    silent_band: Type.Optional(Type.Tuple([Type.Number(), Type.Number()])),
  },
  // No extra keys: a { warn, map } hybrid must be rejected here exactly like the JSON tier
  // rejects it (cross-tier parity — see the shared checkNoulHandler invariants).
  { additionalProperties: false },
);

const SPEC_SCHEMA = Type.Object({
  instructions: Type.String(),
  criteria: Type.Object({ true: Type.String(), false: Type.String() }),
  state: Type.Record(Type.String(), Type.Unknown()),
});

const DECISION_SCHEMA = Type.Object({
  severity: Type.Union([Type.Literal("error"), Type.Literal("warn"), Type.Null()]),
  data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

/**
 * Validates one classify-returned StateSchema; throws a plain contract-violation Error — the engine
 * catches it per call and streams it as RULE_FAILED naming rule + element (run-time, non-fatal).
 */
export function validateStateSpec(
  spec: unknown,
  ruleName: string,
  element: string,
): Static<typeof SPEC_SCHEMA> {
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
  return spec as Static<typeof SPEC_SCHEMA>;
}

/** Validates one handleClassification decision; throws a contract-violation Error (see above). */
export function validateDecision(
  decision: unknown,
  ruleName: string,
  index: number,
): Static<typeof DECISION_SCHEMA> {
  if (!Value.Check(DECISION_SCHEMA, decision)) {
    throw new Error(
      'custom rule "' +
        ruleName +
        '" handleClassification returned an invalid decision at index ' +
        String(index) +
        ' — expected { severity: "error" | "warn" | null, message?, data? }',
    );
  }
  return decision as Static<typeof DECISION_SCHEMA>;
}

function isRole(t: unknown): boolean {
  return typeof t === "string" && (CUSTOM_TARGET_ROLES as readonly string[]).includes(t);
}

function validTarget(target: CustomRule["target"]): boolean {
  return (
    typeof target === "function" ||
    isRole(target) ||
    (Array.isArray(target) && target.length > 0 && target.every((t) => isRole(t)))
  );
}

/** Validates one rule object; the error names the rule. FATAL at load. */
export function validateCustomRule(rule: unknown, file: string): CustomRule {
  const fail = (message: string): never => {
    throw new SetupError("RULE_INVALID", "custom rule in " + file + ": " + message);
  };
  if (typeof rule !== "object" || rule === null) fail("rules[] entry is not an object");
  const r = rule as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name === "") fail('rule has no "name" (non-empty string)');
  const name = r.name;
  if (r.kind !== undefined && r.kind !== "noul") {
    fail(
      '"' +
        name +
        '": kind "' +
        String(r.kind) +
        '" is not supported in custom rules yet (noul only)',
    );
  }
  if (!validTarget(r.target as CustomRule["target"])) {
    fail(
      '"' +
        name +
        '": invalid target — expected one of ' +
        CUSTOM_TARGET_ROLES.join(", ") +
        ", a non-empty list of them, or an (elements) => Element[] function",
    );
  }
  if (typeof r.classify !== "function") fail('"' + name + '": missing classify(self, ctx)');
  // Per-rule scoping shares the JSON tier's checker - same bad shapes, same field-naming messages.
  const scopeProblem = checkRuleScope({
    include: r.include as readonly string[] | undefined,
    exclude: r.exclude as readonly string[] | undefined,
  });
  if (scopeProblem !== null) fail('"' + name + '": ' + scopeProblem);
  const hasHandle = r.handle !== undefined;
  const hasPolicyFn = r.handleClassification !== undefined;
  if (hasHandle === hasPolicyFn) {
    fail(
      '"' +
        name +
        '": exactly one policy is required — handle (data) or handleClassification (callback)',
    );
  }
  if (hasHandle) {
    if (!Value.Check(HANDLE_SCHEMA, r.handle)) {
      fail(
        '"' +
          name +
          '": handle must be the typed noul handler { warn: { greater_than | less_than }, error?, silent_band? }',
      );
    }
    const h = r.handle as CustomHandleData;
    // custom rules are noul-only, so the question type is fixed: a score map here is the same
    // tier-mismatch the JSON loader rejects as CONFIG_INVALID.
    if ("map" in h) fail('"' + name + '": handle.map: a score handler on a noul rule');
    const problem = checkNoulHandler(h);
    if (problem !== null) fail('"' + name + '": ' + problem);
  }
  if (hasPolicyFn && typeof r.handleClassification !== "function") {
    fail('"' + name + '": handleClassification must be a function');
  }
  return r as unknown as CustomRule;
}

/**
 * The virtual module's sole export: the typed TS-config entry. Accepts the same keys a top-level
 * config takes, minus customRules; passes the object through unchanged (the author's literal type
 * survives, so declarative entries and callback rules compose alike — design
 * config-composition/03).
 */
export function defineConfig(config: TsConfig): TsConfig {
  const fail = (message: string): never => {
    throw new SetupError("RULE_INVALID", "defineConfig: " + message);
  };
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    fail("takes one config object");
  }
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      fail(
        '"' +
          key +
          '" is not allowed in a TS config — a TS config takes the same keys a config file takes, minus customRules',
      );
    }
  }
  const rules = config.rules;
  if (rules !== undefined && !Array.isArray(rules)) fail('"rules" must be an array');
  return config;
}

/** The keys a TS config may carry: the config surface, minus customRules (by design). */
const CONFIG_KEYS: ReadonlySet<string> = new Set([
  "$schema",
  "input",
  "inputType",
  "rules",
  "include",
  "exclude",
  "disable",
  "apiKey",
  "concurrency",
  "timeout",
]);
