/**
 * The TS-rule contract (tmp/designs/rules-context/01..04): rules authored in TypeScript, executed
 * by jint on the embedded runtime. A rule file exports defineConfig({ rules: [...] }) — a partial
 * config contributing rules ONLY — and every handler (target fn, classify, handleClassification)
 * returns data; jint, never the rule, calls the classifier. The runtime validation here is the
 * contract enforcement (sdk.d.ts is editor DX only — the runtime does NOT typecheck).
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { checkRuleScope } from "../scope.ts";
import { checkNoulHandler } from "../sensors/handle.ts";
import { SetupError, type RuleResult, type RuleTarget } from "../types.ts";

/**
 * The element a rule sees: identity, role, source, span, and its parent (hierarchy rides on the
 * element).
 */
export interface TsElement {
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
  readonly parent: TsElement | null;
}

/** The rule's environment, assembled by the engine after target resolution (v1: targets only). */
export interface RuleContext {
  /** The resolved elements for this rule — the request's result, aligned with results. */
  readonly targets: readonly TsElement[];
}

/**
 * One compiled judgment: the question text, the criteria, and the freely composed state the model
 * judges. jint schema-validates the spec, applies per-part size backstops, serializes it, and calls
 * jev — the rule NEVER sees the classifier. Composition is free; observability (the wire dumps) is
 * the guarantee.
 */
export interface StateSpec {
  readonly instructions: string;
  readonly criteria: { readonly true: string; readonly false: string };
  readonly state: Record<string, unknown>;
}

/** The declarative policy (data tier, same typed shape as JSON noul rules; exactly one per rule). */
export interface TsHandleData {
  readonly fires_when: "true" | "false";
  readonly warn_at: number;
  readonly error_at?: number;
  readonly silent_band?: readonly [number, number];
}

/** One policy decision, aligned by index with ctx.targets: what becomes a finding. */
export interface TsDecision {
  /** Null = silent (measurement only, no finding). */
  readonly severity: "error" | "warn" | null;
  /** Optional custom message: WHY this instance fired, in the rule's domain language. */
  readonly message?: string;
  /** Optional extra structured data, attached to the finding (schema-validated). */
  readonly data?: Record<string, unknown>;
}

/**
 * A TS rule: name, target (the REQUEST), the per-element state-spec compiler, and exactly one
 * policy (declarative handle or the callback form). classify returns ONE spec for self; jint fans
 * it out across ctx.targets. noul-only in v1 — choice/score kinds are rejected at load.
 */
export interface TsRule {
  readonly name: string;
  readonly kind?: "noul";
  readonly target:
    | "functions"
    | "definitions"
    | "comments"
    | "imports"
    | readonly string[]
    | ((elements: readonly TsElement[]) => readonly TsElement[]);
  /** Per resolved target: the state spec for self. Returns data, never calls the classifier. */
  readonly classify: (self: TsElement, ctx: RuleContext) => StateSpec;
  /** Per-rule scoping (issue 008): glob list; absent = the rule applies to all paths. */
  readonly include?: readonly string[];
  /** Per-rule scoping: glob list; ALWAYS wins over include. */
  readonly exclude?: readonly string[];
  /** Policy, data form: the typed noul handler (fires_when defect pole + thresholds). */
  readonly handle?: TsHandleData;
  /**
   * Policy, callback form: called ONCE after all classifications; results[i] <-> ctx.targets[i].
   * Returns one decision per result, aligned by index.
   */
  readonly handleClassification?: (
    results: readonly RuleResult[],
    ctx: RuleContext,
  ) => readonly TsDecision[];
}

/** A TS config fragment: contributes rules ONLY — run-level keys stay in jint.config.json. */
export interface TsConfigFragment {
  readonly rules: readonly TsRule[];
}

/** The element roles a TS rule may target in v1 (unit-level targets stay JSON-tier). */
export const TS_TARGET_ROLES: readonly RuleTarget[] = [
  "functions",
  "definitions",
  "comments",
  "imports",
];

const HANDLE_SCHEMA = Type.Object(
  {
    fires_when: Type.Union([Type.Literal("true"), Type.Literal("false")]),
    warn_at: Type.Number(),
    error_at: Type.Optional(Type.Number()),
    silent_band: Type.Optional(Type.Tuple([Type.Number(), Type.Number()])),
  },
  // No extra keys: a { fires_when, warn_at, map } hybrid must be rejected here exactly like the
  // JSON tier rejects it (cross-tier parity — see the shared checkNoulHandler invariants).
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
  data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

/**
 * Validates one classify-returned StateSpec; throws a plain contract-violation Error — the engine
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
      'ts rule "' + ruleName + '" returned an invalid state spec for ' + element + ": " + messages,
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
      'ts rule "' +
        ruleName +
        '" handleClassification returned an invalid decision at index ' +
        String(index) +
        ' — expected { severity: "error" | "warn" | null, message?, data? }',
    );
  }
  return decision as Static<typeof DECISION_SCHEMA>;
}

function isRole(t: unknown): boolean {
  return typeof t === "string" && (TS_TARGET_ROLES as readonly string[]).includes(t);
}

function validTarget(target: TsRule["target"]): boolean {
  return (
    typeof target === "function" ||
    isRole(target) ||
    (Array.isArray(target) && target.length > 0 && target.every((t) => isRole(t)))
  );
}

/** Validates one rule object; the error names the rule. FATAL at load. */
export function validateTsRule(rule: unknown, file: string): TsRule {
  const fail = (message: string): never => {
    throw new SetupError("RULE_INVALID", "ts rule in " + file + ": " + message);
  };
  if (typeof rule !== "object" || rule === null) fail("rules[] entry is not an object");
  const r = rule as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name === "") fail('rule has no "name" (non-empty string)');
  const name = r.name;
  if (r.kind !== undefined && r.kind !== "noul") {
    fail(
      '"' + name + '": kind "' + String(r.kind) + '" is not supported in TS rules yet (noul only)',
    );
  }
  if (!validTarget(r.target as TsRule["target"])) {
    fail(
      '"' +
        name +
        '": invalid target — expected one of ' +
        TS_TARGET_ROLES.join(", ") +
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
          '": handle must be the typed noul handler { fires_when: "true" | "false", warn_at, error_at?, silent_band? }',
      );
    }
    const h = r.handle as TsHandleData;
    // TS rules are noul-only, so the question type is fixed: a score map here is the same
    // tier-mismatch the JSON loader rejects as CONFIG_INVALID.
    if ("map" in h) fail('"' + name + '": handle.map: a score handler on a noul rule');
    const problem = checkNoulHandler(h);
    if (problem !== null) fail('"' + name + '": ' + problem);
  }
  if (hasPolicyFn && typeof r.handleClassification !== "function") {
    fail('"' + name + '": handleClassification must be a function');
  }
  return r as unknown as TsRule;
}

/**
 * The virtual module's sole export. A fragment contributes rules ONLY: run-level keys (input,
 * exclude, ...) are rejected — they are entry-config, and a fragment has no single run to mean.
 * Takes one fragment or an array of them.
 */
export function defineConfig(
  fragment: TsConfigFragment | readonly TsConfigFragment[],
): TsConfigFragment {
  const fail = (message: string): never => {
    throw new SetupError("RULE_INVALID", "defineConfig: " + message);
  };
  const fragments = Array.isArray(fragment) ? fragment : [fragment];
  if (fragments.length === 0) fail("empty fragment array");
  for (const f of fragments) {
    if (typeof f !== "object" || f === null) fail("fragment is not an object");
    for (const key of Object.keys(f)) {
      if (key !== "rules") {
        fail(
          '"' +
            key +
            '" is not allowed in a TS config fragment — fragments contribute rules ONLY (run-level keys live in jint.config.json)',
        );
      }
    }
    const rules = (f as TsConfigFragment).rules;
    if (!Array.isArray(rules)) fail('"rules" must be an array');
  }
  return fragment as TsConfigFragment;
}
