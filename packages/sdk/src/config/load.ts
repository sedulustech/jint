/**
 * Config loading. jint.config.json is the default; --config names any other (multiple
 * configurations = multiple files, one per purpose).
 *
 * The config file is PLAIN JSON — no comments, no code. TypeBox validates the boundary and its
 * schema doubles as the checked-in jint.schema.json (editor autocomplete via "$schema"); a small
 * generation script (bun run schema) keeps the two from drifting. Handlers in the file are data —
 * typed by the question: choice rules take a score map, noul rules take a per-threshold operator
 * handler (see rules/handle.ts) — and compile to the internal function form here, at the single
 * data -> function seam, where the cross-field checks (type match, map length, threshold order)
 * live. Validation or parse failure maps to CONFIG_INVALID with joined, positioned messages (design
 * §3.5).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { checkRunKnobs } from "../core/jev/pacer.ts";
import { importConfigModule } from "../core/rules/custom/loader.ts";
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

const TARGET_SCHEMA = Type.Union([
  Type.Literal("files"),
  Type.Literal("functions"),
  Type.Literal("definitions"),
  Type.Literal("comments"),
  Type.Literal("imports"),
]);

// Per-rule scoping (issue 008): glob lists over the walk's paths; exclude always wins. Contents
// validated by checkRuleScope so the error names the exact field.
const SCOPE_SCHEMA = Type.Array(Type.String());

// Discriminated on kind: noul rules carry {true,false}, choice rules carry an ordered rubric
// (>= two descriptions indexed by score 0..N). kind stays optional in the noul branch (noul IS
// the default; the loader fills it). The question and the handle are both REQUIRED (policy:
// probes ship real questions and real handles) - a rule without its question would classify
// under an invented prompt and silently recalibrate every reading.
const NOUL_RULE_SCHEMA = Type.Object({
  name: Type.String({
    description:
      "The rule id: findings join back to it; config rules later in the array override same-named earlier ones.",
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
});

const CHOICE_RULE_SCHEMA = Type.Object({
  name: Type.String({
    description:
      "The rule id: findings join back to it; config rules later in the array override same-named earlier ones.",
  }),
  kind: Type.Literal("choice"),
  criteria: Type.Array(Type.String(), { minItems: 2 }),
  instructions: Type.String(),
  target: TARGET_SCHEMA,
  handle: HANDLER_SCHEMA,
  include: Type.Optional(SCOPE_SCHEMA),
  exclude: Type.Optional(SCOPE_SCHEMA),
});

const RULE_SCHEMA = Type.Union([NOUL_RULE_SCHEMA, CHOICE_RULE_SCHEMA]);

/**
 * Schema of jint.config.json — also emitted, verbatim, as the checked-in jint.schema.json (bun run
 * schema). Additional top-level keys (e.g. "$schema", consumers' own metadata) are allowed and
 * ignored.
 */
export const CONFIG_SCHEMA = Type.Object({
  $schema: Type.Optional(Type.String()),
  // Optional: rules-only probe configs are valid when the CLI supplies a path positional;
  // lint() keeps the empty-input backstop (SetupError CONFIG_INVALID).
  input: Type.Optional(Type.String()),
  inputType: Type.Optional(KIND_SCHEMA),
  rules: Type.Optional(Type.Array(Type.Union([Type.String(), RULE_SCHEMA]))),
  // Config-level include: when set, ONLY matching paths are measured (the walk-wide file
  // filter; per-rule include narrows further). Symmetrical with exclude, same glob semantics.
  include: Type.Optional(Type.Array(Type.String())),
  exclude: Type.Optional(Type.Array(Type.String())),
  disable: Type.Optional(Type.Array(Type.String())),
  apiKey: Type.Optional(Type.String()),
  // Run knobs (see jev/pacer.ts): concurrency = in-flight ceiling. Floors are enforced in
  // validateConfig so the error names the field.
  concurrency: Type.Optional(
    Type.Number({
      description:
        "Max in-flight classifier calls, run-wide (the wall-clock knob). Default 16 (measured: 53.9 rps at 16, zero 429s), max 64.",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description:
        "Per-call classifier timeout, seconds (liveness, not retry - the SDK owns retries). Default 30 (~80x the measured p95 of 380ms). A hung call becomes a per-element JEV_TIMEOUT failure.",
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
  readonly apiKey?: string;
  /** In-flight classifier-call ceiling (the wall-clock knob; default 16, max 64). */
  readonly concurrency?: number;
  /** Per-call classifier timeout, seconds (default 30); a hung call becomes JEV_TIMEOUT. */
  readonly timeout?: number;
  /** Load-time scope warnings (a rule whose exclude cancels its include): surfaced as notes. */
  readonly warnings?: readonly string[];
}

/**
 * The public entry: dispatches on the config file's extension. Both tiers share the boundary
 * (validateConfig) and differ only in how bytes become an object - read + parse for the declarative
 * tier, gated import for the imperative tier.
 */
export interface LoadOptions {
  /**
   * The compiled defaults baseline: resolves string rule names and the rules-less config. The sdk
   * knows no rules - the entry point supplies its bundled set (the CLI: @jint/defaults).
   */
  baseline?: Record<string, Rule>;
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
  return validateConfig(raw, path, options?.baseline);
}

/**
 * The imperative tier: a TS module (jint.config.ts) default-exporting defineConfig({...}). Loads
 * through the config-module loader - the gate allows jint:* virtual modules, the first-party
 *
 * @jint/defaults package (install-time versioned), and relative/absolute files - then validates
 * through the same boundary as JSON. Inline callback rules (a rules entry carrying a classify /
 * handleClassification / function target) are extracted BEFORE the boundary check: they are
 * CustomRules, not data, and run through the custom engine at lint time.
 */
export async function loadTsConfig(path: string, options?: LoadOptions): Promise<ResolvedConfig> {
  const abs = resolve(path);
  const raw = (await importConfigModule(abs)) as { rules?: unknown[] };
  if (raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SetupError(
      "CONFIG_INVALID",
      `ts config must default-export defineConfig({...}): ${path}`,
    );
  }
  const customRules: CustomRule[] = [];
  const declarative = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(declarative.rules)) {
    declarative.rules = declarative.rules.filter((entry) => {
      if (!isCallbackRule(entry)) return true;
      customRules.push(validateCustomRule(entry, path));
      return false;
    });
  }
  const resolved = validateConfig(declarative, path, options?.baseline, customRules);
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

/** True when a rules entry is a callback CustomRule (a function anywhere in its shape). */
function isCallbackRule(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const r = entry as {
    classify?: unknown;
    handleClassification?: unknown;
    target?: unknown;
  };
  return (
    typeof r.classify === "function" ||
    typeof r.handleClassification === "function" ||
    typeof r.target === "function"
  );
}

/**
 * Validates the boundary shape, compiles data handles; static types derive from the same schema.
 * `customRules` are the TS tier's already-validated inline callback rules — attached to the
 * resolved config and counted in the measures-something backstop, never re-validated here.
 */
export function validateConfig(
  raw: unknown,
  source: string,
  baseline?: Record<string, Rule>,
  customRules: readonly CustomRule[] = [],
): ResolvedConfig {
  if (!Value.Check(CONFIG_SCHEMA, raw)) {
    // A bad rule entry collapses into the schema union's generic "Expected union value"; dive
    // into rule objects so the message names the exact field (e.g. /rules/0/instructions).
    const messages = [...Value.Errors(CONFIG_SCHEMA, raw)].map((err) =>
      err.path === "" ? "/ " + err.message : `${err.path} ${err.message}`,
    );
    const ruleErrors = Array.isArray((raw as { rules?: unknown }).rules)
      ? ((raw as { rules: unknown[] }).rules as unknown[])
          .map((entry, i) => {
            if (typeof entry !== "object" || entry === null) return [];
            // The union reports one generic error; validate each branch and surface the closer
            // branch's field errors (the one that failed on fewer fields — e.g. a noul rule
            // missing only its instructions).
            const branchErrors = [NOUL_RULE_SCHEMA, CHOICE_RULE_SCHEMA].map(
              (branch): [string, string][] =>
                [...Value.Errors(branch, entry)].map(
                  (e) => [`/rules/${i}${e.path}`, e.message] as [string, string],
                ),
            );
            // The branch that failed on FEWER fields is the shape the author intended (e.g. a
            // noul rule missing only its instructions); surface its field errors.
            const best = branchErrors.sort((a, b) => a.length - b.length)[0] ?? [];
            return best.map(([p, msg]) => `${p} ${msg}`);
          })
          .flat()
      : [];
    throw new SetupError(
      "CONFIG_INVALID",
      `invalid config ${source}: ${[...ruleErrors, ...messages].join("; ")}`,
    );
  }
  const parsed = raw as Static<typeof CONFIG_SCHEMA>;
  // No rules key = the default rule set; entries select a default by name or declare a full rule
  // (last wins per name). disable removes by name afterwards — set membership, not policy.
  const byName = new Map<string, Rule>();
  if (parsed.rules === undefined) {
    if (baseline === undefined) {
      throw new SetupError(
        "CONFIG_NO_RULES",
        `invalid config ${source}: no rules to run - the config declares no rules and no defaults baseline was provided`,
      );
    }
    for (const rule of Object.values(baseline)) byName.set(rule.name, rule);
  } else {
    for (const entry of parsed.rules) {
      if (typeof entry === "string") {
        const rule = baseline?.[entry];
        if (rule === undefined) {
          throw new SetupError(
            "CONFIG_INVALID",
            `invalid config ${source}: unknown rule name '${entry}'${
              baseline === undefined ? " - no defaults baseline was provided" : ""
            }`,
          );
        }
        byName.set(entry, rule);
      } else {
        byName.set(entry.name, compileRule(entry, source));
      }
    }
  }
  for (const name of parsed.disable ?? []) byName.delete(name);
  // A run that would measure NOTHING is a config error, not a "0 rules" headline: the resolved
  // set must be non-empty across both rule forms. Setup failure, named, like every config problem.
  if (byName.size === 0 && customRules.length === 0) {
    throw new SetupError(
      "CONFIG_NO_RULES",
      `invalid config ${source}: no rules to run - declare at least one rule, or drop the disable list`,
    );
  }
  // Per-rule scope validation + legal-cancellation warnings (never errors, per issue 008).
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
    apiKey?: string;
    concurrency?: number;
    timeout?: number;
    warnings?: string[];
  } = {
    input: parsed.input ?? "",
    rules: [...byName.values()],
    customRules,
    include: parsed.include ?? [],
    exclude: parsed.exclude ?? [],
  };
  if (parsed.inputType !== undefined) resolved.inputType = parsed.inputType;
  if (parsed.apiKey !== undefined) resolved.apiKey = parsed.apiKey;
  // Same validation pass as the handler checks: the error names the exact field. Schema floors
  // (>= 1, > 0) are validated here too so the message names the field, not a union branch.
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

/** The data -> function seam for one rule: validates the handler, compiles, freezes shape. */
export function compileRule(entry: Static<typeof RULE_SCHEMA>, source: string): Rule {
  const isChoice = entry.kind === "choice";
  const handle = compileDataHandle(
    entry.handle,
    entry.name,
    source,
    isChoice,
    isChoice ? (entry.criteria as readonly string[]) : [],
  );
  const scope = {
    ...(entry.include !== undefined && { include: entry.include }),
    ...(entry.exclude !== undefined && { exclude: entry.exclude }),
  };
  const handleSnapshot = entry.handle;
  if (entry.kind !== "choice") {
    return {
      name: entry.name,
      instructions: entry.instructions,
      criteria: entry.criteria,
      target: entry.target,
      handle,
      handleData: handleSnapshot,
      ...scope,
    };
  }
  return {
    name: entry.name,
    kind: "choice",
    criteria: entry.criteria as [string, string, ...string[]],
    instructions: (entry as { instructions: string }).instructions,
    target: entry.target,
    handle,
    handleData: handleSnapshot,
    ...scope,
  };
}
