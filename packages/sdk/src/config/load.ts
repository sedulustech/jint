/**
 * Config loading, two tiers behind one boundary: the declarative tier reads a plain JSON file (no
 * comments, no code) and the imperative tier imports a TS module. Validation or parse failure
 * becomes a named config error with joined, positioned messages. Handlers in the file are data —
 * typed by the question kind — and compile to their function form here, at the single data ->
 * function seam, where the cross-field checks (type match, map length, threshold order) live.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ruleTargets } from "@jint/contract";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {} from "../core/grammars/grammars.ts";
import {} from "../core/grammars/query.ts";
import { closestName } from "../core/lint.ts";
import { checkRunKnobs } from "../core/provider/pacer.ts";
import { importConfigModule, noRulesAdvice } from "../core/rules/custom/loader.ts";
import { validateCustomRule, type CustomRule } from "../core/rules/custom/schema.ts";
import { HANDLER_SCHEMA, compileDataHandle } from "../core/rules/handle.ts";
import { checkRuleScope, ruleMeasuresNothing } from "../core/scope.ts";
import { SetupError, type Rule } from "../core/types.ts";

export const DEFAULT_CONFIG_PATH = "jint.config.json";

/** Config files discovered in the working directory, in preference order. */
const CONFIG_FILES = ["jint.config.ts", "jint.config.json"] as const;

/** The first existing config file (TS preferred); null when the directory declares none. */
export function findConfigFile(cwd = process.cwd()): string | null {
  for (const name of CONFIG_FILES) {
    if (existsSync(resolve(cwd, name))) return resolve(cwd, name);
  }
  return null;
}

const KIND_SCHEMA = Type.Union([Type.Literal("file"), Type.Literal("dir")]);

// A QUALIFIED capture address: {grammar}:{capture} - grammar-scoped targeting for
// grammar-autonomous vocabulary (markdown's markdown:section). Validated at lint
// startup against the merged registry, never at config load.
const CAPTURE_ADDRESS_SCHEMA = Type.String({
  pattern: "^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$",
  description:
    "A qualified capture address {grammar}:{capture} (e.g. markdown:section): targets the named grammar's own capture. Unknown grammar or capture is a setup error.",
});

const TARGET_SCHEMA = Type.Union([
  // derived from THE runtime face (contract ruleTargets) - a new target joins the schema by
  // joining the union there; a literal copy here would be the drift this pass kills
  ...ruleTargets.map((target) => Type.Literal(target)),
  CAPTURE_ADDRESS_SCHEMA,
  Type.Array(
    Type.Union([...ruleTargets.map((target) => Type.Literal(target)), CAPTURE_ADDRESS_SCHEMA]),
  ),
]);

// Per-rule scoping (issue 008): glob lists over the walk's paths; exclude always wins. Contents
// validated eagerly so the error names the exact field.
const SCOPE_SCHEMA = Type.Array(Type.String());

const OVERRIDE_SCHEMA = Type.Optional(
  Type.Boolean({
    description:
      "true: this entry replaces an earlier entry of the same name. Without it a repeated name is a config error, and with it an entry that replaces nothing is too.",
  }),
);

// Discriminated on kind: noul rules carry {true,false}, score rules carry an ordered rubric
// (>= two descriptions indexed by score 0..N), choice rules carry named options (>= two labels). kind stays optional in the noul branch (noul IS
// the default; the loader fills it). The question and the handle are both REQUIRED (policy:
// probes ship real questions and real handles) - a rule without its question would classify
// under an invented prompt and silently recalibrate every reading.
const NOUL_RULE_SCHEMA = Type.Object({
  name: Type.String({
    description:
      "The rule id: findings join back to it. Two entries with one name are a config error unless the later one sets override.",
  }),
  kind: Type.Optional(Type.Literal("noul")),
  instructions: Type.String({
    description:
      "The yes/no question the model answers, specific to the rule's claim. Required - a generic fallback question would silently recalibrate every reading.",
  }),
  criteria: Type.Object(
    { true: Type.String(), false: Type.String() },
    {
      description:
        "The two-sided contract: true names the exact observable condition for yes, false for no. The defect side decides the handle direction.",
    },
  ),
  target: TARGET_SCHEMA,
  handle: HANDLER_SCHEMA,
  include: Type.Optional(SCOPE_SCHEMA),
  exclude: Type.Optional(SCOPE_SCHEMA),
  override: OVERRIDE_SCHEMA,
});

const SCORE_RULE_SCHEMA = Type.Object({
  name: Type.String({
    description:
      "The rule id: findings join back to it. Two entries with one name are a config error unless the later one sets override.",
  }),
  kind: Type.Literal("score"),
  criteria: Type.Array(Type.String(), { minItems: 2 }),
  instructions: Type.String(),
  target: TARGET_SCHEMA,
  handle: HANDLER_SCHEMA,
  include: Type.Optional(SCOPE_SCHEMA),
  exclude: Type.Optional(SCOPE_SCHEMA),
  override: OVERRIDE_SCHEMA,
});

const CHOICE_RULE_SCHEMA = Type.Object({
  name: Type.String({
    description:
      "The rule id: findings join back to it. Two entries with one name are a config error unless the later one sets override.",
  }),
  kind: Type.Literal("choice"),
  criteria: Type.Record(Type.String(), Type.String(), {
    minProperties: 2,
    description:
      "The named options: option label -> what selecting it means. Unordered; the model selects one.",
  }),
  instructions: Type.String(),
  target: TARGET_SCHEMA,
  handle: HANDLER_SCHEMA,
  include: Type.Optional(SCOPE_SCHEMA),
  exclude: Type.Optional(SCOPE_SCHEMA),
  override: OVERRIDE_SCHEMA,
});

const RULE_SCHEMA = Type.Union([NOUL_RULE_SCHEMA, SCORE_RULE_SCHEMA, CHOICE_RULE_SCHEMA]);

/**
 * Schema of the config file's boundary — also emitted, verbatim, as the checked-in editor schema (a
 * generation script keeps them identical). Additional top-level keys (e.g. "$schema", consumers'
 * own metadata) are allowed and ignored.
 */

export const CONFIG_SCHEMA = Type.Object({
  $schema: Type.Optional(Type.String()),
  // Optional: rules-only probe configs are valid when the CLI supplies a path positional;
  // the run-level backstop still rejects an empty input as a config error.
  input: Type.Optional(Type.String()),
  inputType: Type.Optional(KIND_SCHEMA),
  // The rules, and the scope they follow: include/exclude are the default scope of every rule and
  // the walk's file filter - a rule with no include of its own follows them, and a rule include
  // claims its files across them (docs/config.md). Same glob semantics as a rule's own scope.
  rules: Type.Optional(
    Type.Object({
      include: Type.Optional(Type.Array(Type.String())),
      exclude: Type.Optional(Type.Array(Type.String())),
      use: Type.Optional(Type.Array(Type.Union([Type.String(), RULE_SCHEMA]))),
    }),
  ),
  // Secret-shaped denylist override for the directory walk (gitignore-flavored patterns,
  // negations allowed; default = the built-in frozen denylist). For repos that
  // legitimately lint secret-shaped files (e.g. .env.example): list the exceptions.
  secretDenylist: Type.Optional(Type.Array(Type.String())),
  disable: Type.Optional(Type.Array(Type.String())),
  apiKey: Type.Optional(
    Type.String({
      description:
        "The API key. Precedence: this, else $JINT_API_KEY, else $OPENAI_API_KEY (which only opens the default url). Never written to a run record.",
    }),
  ),
  url: Type.Optional(
    Type.String({
      description:
        "The Decisions endpoint the questions are posted to; it must end in /decisions. Precedence: this, else $JINT_API_URL, else the url the exported key opens (https://api.openai.com/v1/decisions for $OPENAI_API_KEY).",
    }),
  ),
  // Run knobs: concurrency = in-flight ceiling. Floors are enforced with the other
  // cross-field checks so the error names the field.
  concurrency: Type.Optional(
    Type.Number({
      description:
        "Max in-flight classifier calls, run-wide (the wall-clock knob). Default 16, max 64.",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description:
        "Per-call classifier timeout, seconds (liveness, not retry - the SDK owns retries). Default 30, far above a normal call. A hung call becomes a per-element PROVIDER_TIMEOUT failure.",
    }),
  ),
});

/** The normalized shape every config resolves to before lint runs. */
export interface ResolvedConfig {
  readonly input?: string;
  readonly inputType?: "file" | "dir";
  readonly rules: readonly Rule[];
  /** Inline callback rules from a TS config's rules array (validated); empty for the JSON tier. */
  readonly customRules?: readonly CustomRule[];
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  /** The walk's secret-shaped denylist (config override; default = the built-in denylist). */
  readonly secretDenylist?: readonly string[];
  readonly apiKey?: string;
  /** The Decisions endpoint asked; absent: $JINT_API_URL, then the url the exported key opens. */
  readonly url?: string;
  /** In-flight classifier-call ceiling (the wall-clock knob; default 16, max 64). */
  readonly concurrency?: number;
  /** Per-call classifier timeout, seconds (default 30); a hung call becomes PROVIDER_TIMEOUT. */
  readonly timeout?: number;
  /** Load-time scope warnings (a rule whose exclude cancels its include): surfaced as notes. */
  readonly warnings?: readonly string[];
}

/**
 * The public entry: dispatches on the config file's extension. Both tiers share the boundary and
 * differ only in how bytes become an object - read + parse for the declarative tier, gated import
 * for the imperative tier.
 */
export interface LoadOptions {
  /**
   * The compiled rule catalog: resolves a rule named by a bare string (the JSON tier). The sdk
   * knows no rules - the entry point supplies the catalog of every domain.
   */
  catalog?: Record<string, Rule>;
  /** True: a config with no rules is valid (the structure-only verbs never classify). */
  rulesOptional?: boolean;
}

export function loadConfig(
  path = DEFAULT_CONFIG_PATH,
  options?: LoadOptions,
): Promise<ResolvedConfig> {
  return path.endsWith(".ts") ? loadTsConfig(path, options) : loadDeclarativeConfig(path, options);
}

/**
 * The declarative tier: plain JSON (jint.config.json). Data only - the engine owns every behavior,
 * so nothing here executes and no gate is needed.
 */
export async function loadDeclarativeConfig(
  path: string,
  options?: LoadOptions,
): Promise<ResolvedConfig> {
  const abs = resolve(path);
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch (e) {
    throw new SetupError("CONFIG_INVALID", `config file not found: ${path}`, { cause: e });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new SetupError(
      "CONFIG_INVALID",
      `config file is not valid JSON: ${path}: ${detail} (plain JSON only — no comments, no trailing commas)`,
      { cause: e },
    );
  }
  return validateConfig(raw, path, options?.catalog, undefined, options?.rulesOptional);
}

/**
 * The imperative tier. The import gate allows only the virtual modules, and relative/absolute
 * files. Inline callback rules are extracted BEFORE the boundary check because they are code, not
 * data: they run through the custom engine at lint time, while the declarative entries around them
 * validate as JSON.
 */
export async function loadTsConfig(path: string, options?: LoadOptions): Promise<ResolvedConfig> {
  const abs = resolve(path);
  const raw = (await importConfigModule(abs)) as { rules?: { use?: unknown[] } };
  if (raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SetupError(
      "CONFIG_INVALID",
      `ts config must default-export defineConfig({...}): ${path}`,
    );
  }
  const customRules: CustomRule[] = [];
  const declarative = { ...(raw as Record<string, unknown>) };
  const rules = declarative.rules as { use?: unknown[] } | undefined;
  if (rules !== undefined && Array.isArray(rules.use)) {
    declarative.rules = {
      ...rules,
      use: rules.use.filter((entry) => {
        if (!isCallbackRule(entry)) return true;
        customRules.push(validateCustomRule(entry, path));
        return false;
      }),
    };
  }
  const resolved = validateConfig(
    declarative,
    path,
    options?.catalog,
    customRules,
    options?.rulesOptional,
  );
  // names are global across the two rule forms: a callback rule shadowing a declarative one (or
  // vice versa) in the same array is a config contradiction, fatal and named
  const declarativeNames = new Set(resolved.rules.map((rule) => rule.name));
  for (const rule of resolved.customRules ?? []) {
    if (declarativeNames.has(rule.name)) {
      throw new SetupError(
        "RULE_INVALID",
        'duplicate rule name "' +
          rule.name +
          '" in the rules tier (declarative and callback forms collide) — names are global',
      );
    }
  }
  return resolved;
}

/**
 * The extraction marker: a function can only be authored in TS, so any function field marks an
 * entry as the imperative tier's.
 */
function isCallbackRule(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const r = entry as {
    classify?: unknown;
    handle?: unknown;
    target?: unknown;
  };
  return (
    typeof r.classify === "function" ||
    typeof r.handle === "function" ||
    typeof r.target === "function"
  );
}

function ruleEntries(raw: unknown): unknown[] | undefined {
  const entries = (raw as { rules?: { use?: unknown } }).rules?.use;
  return Array.isArray(entries) ? entries : undefined;
}

/**
 * Per-entry rule-schema errors, best branch per entry: a rule entry that fails the schema union
 * collapses into one generic message, so each entry is re-validated against its kind's branch here
 * and the branch that failed on fewer fields is the shape the author intended. Entries that are not
 * objects contribute nothing (the generic schema errors cover them).
 */
function ruleFieldErrors(raw: unknown): string[] {
  return (ruleEntries(raw) ?? [])
    .map((entry, i) => {
      if (typeof entry !== "object" || entry === null) return [];
      const branchErrors = [NOUL_RULE_SCHEMA, CHOICE_RULE_SCHEMA].map(
        (branch): [string, string][] =>
          [...Value.Errors(branch, entry)].map(
            (e) => [`/rules/use/${i}${e.path}`, e.message] as [string, string],
          ),
      );
      const intendedBranch = branchErrors.sort((a, b) => a.length - b.length)[0] ?? [];
      return intendedBranch.map(([p, msg]) => `${p} ${msg}`);
    })
    .flat();
}

/**
 * The boundary failed: name the exact field. The FIRST rule-path error becomes the invalid-rule
 * detail; a path outside a rule index (top-level schema problems) throws without one. String#match,
 * not the RegExp method - the no-git guard forbids that token under src/.
 */
function throwConfigInvalid(raw: unknown, source: string): never {
  const messages = [...Value.Errors(CONFIG_SCHEMA, raw)].map((err) =>
    err.path === "" ? "/ " + err.message : `${err.path} ${err.message}`,
  );
  const ruleErrors = ruleFieldErrors(raw);
  const rulePath = (ruleErrors[0] ?? "").match(/^\/rules\/use\/(\d+)\/(\S+)/);
  const field = rulePath?.[2];
  // present-vs-missing: a field the entry HAS but that failed validation is an INVALID field,
  // not a missing one - the CLI words the two differently (owner ruling: no more missing-target
  // for a target that is present and malformed)
  const ruleIndex = rulePath !== null ? Number(rulePath[1]) : -1;
  const entry = ruleIndex >= 0 ? ruleEntries(raw)?.[ruleIndex] : undefined;
  const present =
    entry !== undefined &&
    field !== undefined &&
    typeof entry === "object" &&
    entry !== null &&
    field in (entry as Record<string, unknown>);
  // A present-but-undefined detail is read the same as an absent one downstream, so the field is
  // set only when both halves of the path are known.
  const detail =
    rulePath !== null && field !== undefined
      ? ({ kind: "invalid-rule", ruleIndex: Number(rulePath[1]), field, present } as const)
      : undefined;
  throw new SetupError(
    "CONFIG_INVALID",
    `invalid config ${source}: ${[...ruleErrors, ...messages].join("; ")}`,
    {
      detail,
    },
  );
}

/**
 * Entries to compiled rules. A bare name selects a compiled catalog rule, an object declares a full
 * rule through the single compile seam. A repeated name is a config error naming both entries -
 * nothing wins silently - unless the later entry sets override: true, which replaces the earlier
 * one and is itself an error when there is nothing to replace. No entries is a config error that
 * lists the domains. An unknown name suggests the closest known one - names are how a consumer
 * selects rules, so a near-miss deserves a pointer, not just a rejection.
 */
function resolveRules(
  entries: readonly (string | Static<typeof RULE_SCHEMA>)[] | undefined,
  catalog: Record<string, Rule> | undefined,
  source: string,
  rulesOptional: boolean,
): Map<string, Rule> {
  const byName = new Map<string, Rule>();
  const at = new Map<string, number>();
  if (entries === undefined) {
    if (rulesOptional) return byName;
    throw new SetupError(
      "CONFIG_NO_RULES",
      `invalid config ${source}: no rules to run - the config declares no rules; ${noRulesAdvice()}`,
    );
  }
  entries.forEach((entry, index) => {
    const name = typeof entry === "string" ? entry : entry.name;
    const override = typeof entry !== "string" && entry.override === true;
    const earlier = at.get(name);
    if (earlier !== undefined && !override) {
      throw new SetupError(
        "CONFIG_INVALID",
        `invalid config ${source}: rule '${name}' is declared twice (rules.use[${earlier}] and rules.use[${index}]) - drop one, or set override: true on rules.use[${index}] to replace rules.use[${earlier}]`,
      );
    }
    if (earlier === undefined && override) {
      throw new SetupError(
        "CONFIG_INVALID",
        `invalid config ${source}: rules.use[${index}] sets override: true but no earlier rule is named '${name}' - drop override`,
      );
    }
    at.set(name, index);
    if (typeof entry === "string") {
      const rule = catalog?.[entry];
      if (rule === undefined) {
        const valid = Object.keys(catalog ?? {});
        const suggest = closestName(entry, new Set(valid));
        throw new SetupError(
          "CONFIG_INVALID",
          `invalid config ${source}: unknown rule name '${entry}'${catalog === undefined ? " - no rule catalog was provided" : ""}`,
          {
            detail: {
              kind: "unknown-rule",
              valid,
              suggest,
            },
          },
        );
      }
      byName.set(entry, rule);
    } else {
      const { override: _override, ...spec } = entry;
      byName.set(entry.name, compileRule(spec as typeof entry, source));
    }
  });
  return byName;
}

/**
 * Extra top-level keys are ignored by the schema, so a config still written with the old top-level
 * include/exclude would silently measure files it meant to leave out, and a rules array would read
 * as a schema error: say so and name the move.
 */
function rejectRetiredShapes(raw: unknown, source: string): void {
  const config = raw as { rules?: unknown };
  if (Array.isArray(config.rules)) {
    throw new SetupError(
      "CONFIG_INVALID",
      `invalid config ${source}: rules is now an object - write rules: { use: [...] }; its include/exclude are the default scope of every rule`,
    );
  }
  const retired = ["include", "exclude"].filter((key) => key in (raw as object));
  if (retired.length === 0) return;
  throw new SetupError(
    "CONFIG_INVALID",
    `invalid config ${source}: top-level ${retired.join(" and ")} moved under rules - write rules: { ${retired.map((key) => `${key}: [...]`).join(", ")}, use: [...] }; they are the default scope of every rule, and a rule's own include/exclude still overrides them`,
  );
}

/**
 * The custom-rules argument arrives pre-validated: counted toward the non-empty-run guard, never
 * re-validated here. Static types derive from the same schema the boundary checks.
 */
export function validateConfig(
  raw: unknown,
  source: string,
  catalog?: Record<string, Rule>,
  customRules: readonly CustomRule[] = [],
  rulesOptional = false,
): ResolvedConfig {
  rejectRetiredShapes(raw, source);
  if (!Value.Check(CONFIG_SCHEMA, raw)) throwConfigInvalid(raw, source);
  const parsed = raw as Static<typeof CONFIG_SCHEMA>;
  const byName = resolveRules(parsed.rules?.use, catalog, source, rulesOptional);
  for (const name of parsed.disable ?? []) byName.delete(name);
  // A run that would measure nothing is fatal and named: an empty report must never look like
  // success — the resolved set has to be non-empty across both rule forms.
  if (byName.size === 0 && customRules.length === 0 && !rulesOptional) {
    throw new SetupError(
      "CONFIG_NO_RULES",
      `invalid config ${source}: no rules to run - declare at least one rule, or drop the disable list`,
    );
  }
  // Per-rule scope validation; a scope that cancels a rule entirely is legal, warned, never an error.
  const warnings: string[] = [];
  for (const rule of [...byName.values(), ...customRules]) {
    if (rule.include === undefined && rule.exclude === undefined) continue;
    const scopeProblem = checkRuleScope(rule);
    if (scopeProblem !== null) {
      throw new SetupError(
        "CONFIG_INVALID",
        `invalid config ${source}: rule '${rule.name}' ${scopeProblem}`,
      );
    }
    if (ruleMeasuresNothing(rule)) {
      warnings.push(
        `rule '${rule.name}': exclude fully cancels include - the rule measures nothing (legal, but probably not what you meant)`,
      );
    }
  }
  const resolved: {
    input: string;
    inputType?: Static<typeof KIND_SCHEMA>;
    rules: Rule[];
    customRules: readonly CustomRule[];
    include: string[];
    exclude: string[];
    secretDenylist?: string[];
    apiKey?: string;
    url?: string;
    concurrency?: number;
    timeout?: number;
    warnings?: string[];
  } = {
    input: parsed.input ?? "",
    rules: [...byName.values()],
    customRules,
    include: parsed.rules?.include ?? [],
    exclude: parsed.rules?.exclude ?? [],
  };
  if (parsed.secretDenylist !== undefined) resolved.secretDenylist = parsed.secretDenylist;
  if (parsed.inputType !== undefined) resolved.inputType = parsed.inputType;
  if (parsed.apiKey !== undefined) resolved.apiKey = parsed.apiKey;
  if (parsed.url !== undefined) resolved.url = parsed.url;
  // Run knobs: schema floors are re-checked here so the message names the field, not a union branch.
  const knobProblem = checkRunKnobs({
    concurrency: parsed.concurrency,
    timeout: parsed.timeout,
  });
  if (knobProblem !== null) {
    throw new SetupError("CONFIG_INVALID", `invalid config ${source}: ${knobProblem}`);
  }
  if (parsed.concurrency !== undefined) resolved.concurrency = parsed.concurrency;
  if (parsed.timeout !== undefined) resolved.timeout = parsed.timeout;
  if (warnings.length > 0) resolved.warnings = warnings;
  return Object.freeze(resolved);
}

/**
 * The single seam every declarative rule passes through, so handler invariants are enforced exactly
 * once.
 */
export function compileRule(entry: Static<typeof RULE_SCHEMA>, source: string): Rule {
  // capture-address validation happens at LINT STARTUP against the merged registry - the user
  // grammar dir is not scanned at config load
  const kind = entry.kind ?? "noul";
  const handle = compileDataHandle(
    entry.handle,
    entry.name,
    source,
    kind,
    entry.kind === "score"
      ? entry.criteria
      : entry.kind === "choice"
        ? Object.keys(entry.criteria)
        : [],
  );
  // Direct optional properties: scope consumers gate on !== undefined, so absent and
  // present-undefined behave identically, and the manifest snapshot drops undefined under JSON.
  const scope = {
    include: entry.include,
    exclude: entry.exclude,
  };
  const handleSnapshot = entry.handle;
  const common = {
    name: entry.name,
    instructions: entry.instructions,
    target: entry.target as Rule["target"],
    handle,
    handleData: handleSnapshot,
    ...scope,
  };
  if (entry.kind === "score") {
    return { ...common, kind: "score", criteria: entry.criteria as [string, string, ...string[]] };
  }
  if (entry.kind === "choice") return { ...common, kind: "choice", criteria: entry.criteria };
  return { ...common, criteria: entry.criteria };
}
