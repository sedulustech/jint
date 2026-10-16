/**
 * The TS-rule contract: rules authored in TypeScript, executed by jint on the embedded runtime. A
 * TS config default-exports a config object — a partial config whose rules may be declarative rules
 * or inline callback CustomRules — and every handler (target fn, classify, handle) returns data;
 * jint, never the rule, calls the classifier. The runtime validation here is the contract
 * enforcement (the editor types are DX only — the runtime does NOT typecheck).
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { checkRuleScope } from "../../scope.ts";
import { SetupError, type RuleResult, type RuleTarget } from "../../types.ts";
import { checkNoulHandler } from "../handle.ts";

/** The element a rule sees: the walk inventory materialized for TS rules, parent chain included. */
export interface CustomElement {
  /** Positional label, stable within a run ("d0", "c2", "i0"). */
  readonly id: string;
  /** The owning file: identity and wire naming derive from it. */
  readonly path: string;
  // Derived from contract's Element["kind"] minus "file" — one vocabulary, no hand-copied mirror.
  readonly capture: import("../../types.ts").ElementCapture;
  readonly source: string;
  readonly span: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
    readonly startByte: number;
    readonly endByte: number;
  };
  /** The comment node(s) consumed into this element's leading run (target grammar: "comments"). */
  readonly attachedComment?: readonly string[];
  /** Non-empty comments inside this element's body (target grammar: "comments"). */
  readonly internalCommentCount?: number;
  /** Docstrings this definition owns (the pair split): documentation the frame carries. */
  readonly docstringCount?: number;
  /**
   * For a comment element a definition owns (a docstring): who it documents. Its presence is what
   * makes the comment DOCUMENTATION (target grammar: "comments") rather than loose.
   */
  readonly docstringOf?: { readonly kind: "module" | "function" | "class"; readonly name: string };
  /** The enclosing element, when this element sits inside one; null at the top level. */
  readonly parent: CustomElement | null;
}

/** The rule's environment, assembled by the engine after target resolution. */
export interface RuleContext {
  /**
   * The resolved elements for this rule, in walk order — positionally paired with the rule's
   * results.
   */
  readonly targets: readonly CustomElement[];
}

/**
 * One compiled judgment. jint schema-validates the spec, applies per-part size backstops,
 * serializes it, and calls jev — the rule NEVER sees the classifier. Composition is free;
 * observability (the wire dumps) is the guarantee.
 */
export interface StateSchema {
  readonly instructions: string;
  readonly criteria: { readonly true: string; readonly false: string };
  readonly state: Record<string, unknown>;
}

/** The policy's data encoding (data tier, same typed shape as JSON noul rules). */
// The declarative noul handle for custom rules: the contract's per-threshold operator form.
export type CustomHandleData = import("@jint/contract").NoulHandlerData;

/** One policy decision, positionally paired with the rule's results: what becomes a finding. */
export interface CustomDecision {
  /** Null = silent (measurement only, no finding). */
  readonly severity: "error" | "warn" | null;
  /**
   * An instruction to the caller fixing the finding (typically an LLM doing the fix); severity says
   * whether, message says how. Rendered beneath the finding line; schema-validated.
   */
  readonly message?: string;
}

/**
 * A custom rule: name, target (the REQUEST), the per-element state-schema compiler, and its one
 * policy, handle (required — data or a function; a measurement-only rule silences itself with () =>
 * []). classify returns ONE spec per call; jint fans it out across the rule's resolved targets.
 * noul-only in v1 — the other kinds are rejected at load.
 */
export interface CustomRule {
  readonly name: string;
  readonly kind?: "noul";
  readonly target:
    | "functions"
    | "classes"
    | "methods"
    | "types"
    | "bindings"
    | "definitions"
    | "comments"
    | "loose-comments"
    | "imports"
    | readonly string[]
    | ((elements: readonly CustomElement[]) => readonly CustomElement[]);
  /** Per resolved target: the state spec for that element. Returns data, never calls the classifier. */
  readonly classify: (self: CustomElement, ctx: RuleContext) => StateSchema;
  /** Per-rule scoping (issue 008): glob list; absent = the rule applies to all paths. */
  readonly include?: readonly string[];
  /** Per-rule scoping: glob list; ALWAYS wins over include. */
  readonly exclude?: readonly string[];
  /**
   * The rule's policy — REQUIRED, exactly one per rule, in one of two encodings. Data is the
   * declarative form (JSON-expressible: the typed noul handler, per-threshold comparison
   * operators); a function is the TS-only escape hatch, called ONCE after all classifications
   * (results[i] <-> ctx.targets[i]) and returns one decision per result, aligned by index. The
   * field either is data or is a function, never both; a measurement-only rule returns [] (or
   * all-null severities) from the function form.
   */
  readonly handle:
    | CustomHandleData
    | ((results: readonly RuleResult[], ctx: RuleContext) => readonly CustomDecision[]);
}

/**
 * A TS config's shape: the same keys a top-level config takes (the config boundary validates it),
 * minus the custom-rules key. Entries in rules compose last-wins by name: declarative specs (the
 * compiled-in defaults and their spread-and-overrides) and inline callback CustomRules.
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

/** The element captures a custom rule may target in v1 (unit-level targets stay JSON-tier). */
export const CUSTOM_TARGET_ROLES: readonly RuleTarget[] = [
  "functions",
  "classes",
  "methods",
  "types",
  "bindings",
  "definitions",
  "comments",
  "loose-comments",
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
  message: Type.Optional(Type.String()),
});

/**
 * The runtime does NOT typecheck, so the spec is validated here: a violation throws a plain
 * contract-violation Error, which the engine catches per call and streams as a named per-unit
 * failure (run-time, non-fatal).
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

/** Validates one callback-handle decision; throws a contract-violation Error (see above). */
export function validateDecision(
  decision: unknown,
  ruleName: string,
  index: number,
): Static<typeof DECISION_SCHEMA> {
  if (!Value.Check(DECISION_SCHEMA, decision)) {
    throw new Error(
      'custom rule "' +
        ruleName +
        '" handle returned an invalid decision at index ' +
        String(index) +
        ' — expected { severity: "error" | "warn" | null, message? }',
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

/** Fatal at load: a rejected custom rule never reaches the engine. */
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
  if (typeof handle === "function") {
    // callback arm: its shape is the engine's run-time contract, nothing to check at load
  } else if (!Value.Check(HANDLE_SCHEMA, handle)) {
    fail(
      '"' +
        name +
        '": handle must be the typed noul handler { warn: { greater_than | less_than }, error?, silent_band? } or a (results, ctx) => decisions function',
    );
  } else {
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

/** The keys a TS config may carry: the config surface, minus the custom-rules tier. */
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
