/**
 * Config loading, two tiers behind one boundary: the declarative tier reads a plain JSON file (no
 * comments, no code) and the imperative tier imports a TS module. Validation or parse failure
 * becomes a named config error with joined, positioned messages. Handlers in the file are data —
 * typed by the question kind — and compile to their function form here, at the single data ->
 * function seam, where the cross-field checks (type match, map length, threshold order) live.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { grammar, knownLanguages } from "../core/input/grammars.ts";
import { ELEMENT_CAPTURES, scmCode } from "../core/input/query.ts";
import { checkRunKnobs } from "../core/jev/pacer.ts";
import { closestName } from "../core/lint.ts";
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

// A QUALIFIED capture address: {grammar}:{capture} - grammar-scoped targeting for
// grammar-autonomous vocabulary (markdown's markdown:section). The bare form drifted; qualified
// AND validated is the deliberate lane: an unknown grammar or an unknown capture in a loaded
// grammar is a setup error (see assertCaptureAddress), never a silent no-match.
const CAPTURE_ADDRESS_SCHEMA = Type.String({
  pattern: "^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$",
  description:
    "A qualified capture address {grammar}:{capture} (e.g. markdown:section): targets the named grammar's own capture. Unknown grammar or capture is a setup error.",
});

const QUALIFIED_ADDRESS = /^([a-z][a-z0-9_-]*):([a-z][a-z0-9_-]*)$/;

const SHARED_TARGETS = new Set([
  "files",
  "functions",
  "classes",
  "methods",
  "types",
  "bindings",
  "definitions",
  "comments",
  "loose-comments",
  "imports",
]);

/**
 * The captures a grammar EMITS: derived syntactically from its queries - the .scm IS the grammar's
 * interface, single source, no second authority. SYNTACTIC on purpose: a capture bound only under a
 * predicate still counts as emitted (the .scm names it; predicates gate matching, not vocabulary).
 * Element captures only - @name and reserved tokens are not targets. `;` comment lines are stripped
 * first: prose naming a capture does not emit it.
 */
export function emittedCaptures(grammarId: string): readonly string[] {
  // the SHARED .scm reader: strings blanked, then comments cut - a capture named in a trailing
  // comment or a predicate string is prose, not an emitted fact (an address must never validate
  // against a capture the grammar would not actually extract)
  const scm = scmCode(grammar(grammarId).queries);
  const named = new Set([...scm.matchAll(/@([A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]!));
  return ELEMENT_CAPTURES.filter((c) => named.has(c));
}
/**
 * Setup-time loudness for targets, at LOAD always (even when that grammar's files never walk this
 * run - no deferred loudness): a qualified address is checked against the grammar's EMITTED
 * captures with two distinguished failures - grammar not registered (named with the loaded ids) vs
 * capture not emitted (named with the emitted set, e.g. "markdown emits: section, comment"). A bare
 * name that is neither a shared target nor an address is a typo and fails loudly too - resolution
 * never silently no-matches a well-formed target. A well-formed address finding zero elements in a
 * run is fine (measured nothing); an invalid NAME never reaches a run.
 */
function assertCaptureAddress(target: string): void {
  const match = target.match(QUALIFIED_ADDRESS);
  if (match === null) {
    if (SHARED_TARGETS.has(target)) return;
    throw new SetupError(
      "CONFIG_INVALID",
      'unknown target "' +
        target +
        '" (shared targets: ' +
        [...SHARED_TARGETS].join(", ") +
        "; or a grammar-scoped capture address: grammar:capture)",
    );
  }
  const grammarId = match[1]!;
  const capture = match[2]!;
  const loaded = knownLanguages();
  if (!loaded.includes(grammarId)) {
    throw new SetupError(
      "CONFIG_INVALID",
      'capture address "' +
        target +
        '" names an unknown grammar "' +
        grammarId +
        '" (loaded grammars: ' +
        loaded.join(", ") +
        ")",
    );
  }
  const emitted = emittedCaptures(grammarId);
  if (!emitted.includes(capture)) {
    throw new SetupError(
      "CONFIG_INVALID",
      'capture address "' +
        target +
        '": grammar "' +
        grammarId +
        '" does not emit "' +
        capture +
        '" (' +
        grammarId +
        " emits: " +
        emitted.join(", ") +
        ")",
    );
  }
}
const TARGET_SCHEMA = Type.Union([
  Type.Literal("files"),
  Type.Literal("functions"),
  Type.Literal("classes"),
  Type.Literal("methods"),
  Type.Literal("types"),
  Type.Literal("bindings"),
  Type.Literal("definitions"),
  Type.Literal("comments"),
  Type.Literal("loose-comments"),
  Type.Literal("imports"),
  CAPTURE_ADDRESS_SCHEMA,
  // the explicit list: the defaults use it (identical behavior to the old definitions shorthand)
  Type.Array(
    Type.Union([
      Type.Literal("files"),
      Type.Literal("functions"),
      Type.Literal("classes"),
      Type.Literal("methods"),
      Type.Literal("types"),
      Type.Literal("bindings"),
      Type.Literal("definitions"),
      Type.Literal("comments"),
      Type.Literal("loose-comments"),
      Type.Literal("imports"),
      CAPTURE_ADDRESS_SCHEMA,
    ]),
  ),
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
  rules: Type.Optional(Type.Array(Type.Union([Type.String(), RULE_SCHEMA]))),
  // Config-level include: when set, ONLY matching paths are measured (the walk-wide file
  // filter; per-rule include narrows further). Symmetrical with exclude, same glob semantics.
  include: Type.Optional(Type.Array(Type.String())),
  exclude: Type.Optional(Type.Array(Type.String())),
  // Secret-shaped denylist override for the directory walk (gitignore-flavored patterns,
  // negations allowed; default = the frozen SECRET_DENYLIST in input/dir.ts). For repos that
  // legitimately lint secret-shaped files (e.g. .env.example): list the exceptions.
  secretDenylist: Type.Optional(Type.Array(Type.String())),
  disable: Type.Optional(Type.Array(Type.String())),
  apiKey: Type.Optional(Type.String()),
  // Run knobs: concurrency = in-flight ceiling. Floors are enforced with the other
  // cross-field checks so the error names the field.
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
  /** The walk's secret-shaped denylist (config override; default = SECRET_DENYLIST). */
  readonly secretDenylist?: readonly string[];
  readonly apiKey?: string;
  /** In-flight classifier-call ceiling (the wall-clock knob; default 16, max 64). */
  readonly concurrency?: number;
  /** Per-call classifier timeout, seconds (default 30); a hung call becomes JEV_TIMEOUT. */
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
   * The compiled defaults baseline: resolves string rule names and the rules-less config. The sdk
   * knows no rules - the entry point supplies its own bundled set.
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
 * The imperative tier. The import gate allows only the virtual modules, the first-party defaults
 * package (install-time versioned), and relative/absolute files. Inline callback rules are
 * extracted BEFORE the boundary check because they are code, not data: they run through the custom
 * engine at lint time, while the declarative entries around them validate as JSON.
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

/**
 * Per-entry rule-schema errors, best branch per entry: a rule entry that fails the schema union
 * collapses into one generic message, so each entry is re-validated against its kind's branch here
 * and the branch that failed on fewer fields is the shape the author intended. Entries that are not
 * objects contribute nothing (the generic schema errors cover them).
 */
function ruleFieldErrors(raw: unknown): string[] {
  if (!Array.isArray((raw as { rules?: unknown }).rules)) return [];
  return ((raw as { rules: unknown[] }).rules as unknown[])
    .map((entry, i) => {
      if (typeof entry !== "object" || entry === null) return [];
      const branchErrors = [NOUL_RULE_SCHEMA, CHOICE_RULE_SCHEMA].map(
        (branch): [string, string][] =>
          [...Value.Errors(branch, entry)].map(
            (e) => [`/rules/${i}${e.path}`, e.message] as [string, string],
          ),
      );
      // The branch that failed on FEWER fields is the shape the author intended.
      const best = branchErrors.sort((a, b) => a.length - b.length)[0] ?? [];
      return best.map(([p, msg]) => `${p} ${msg}`);
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
  const rulePath = (ruleErrors[0] ?? "").match(/^\/rules\/(\d+)\/(\S+)/);
  const field = rulePath?.[2];
  // A present-but-undefined detail is read the same as an absent one downstream, so the field is
  // set only when both halves of the path are known.
  const detail =
    rulePath !== null && field !== undefined
      ? ({ kind: "invalid-rule", ruleIndex: Number(rulePath[1]), field } as const)
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
 * Entries to compiled rules, last wins per name: a bare name selects a compiled baseline default,
 * an object declares a full rule through the single compile seam. No entries means the baseline IS
 * the rule set. An unknown name is a config error that suggests the closest known one — names are
 * how a consumer selects defaults, so a near-miss deserves a pointer, not just a rejection.
 */
function resolveRules(
  entries: readonly (string | Static<typeof RULE_SCHEMA>)[] | undefined,
  baseline: Record<string, Rule> | undefined,
  source: string,
): Map<string, Rule> {
  const byName = new Map<string, Rule>();
  if (entries === undefined) {
    if (baseline === undefined) {
      throw new SetupError(
        "CONFIG_NO_RULES",
        `invalid config ${source}: no rules to run - the config declares no rules and no defaults baseline was provided`,
      );
    }
    for (const rule of Object.values(baseline)) byName.set(rule.name, rule);
    return byName;
  }
  for (const entry of entries) {
    if (typeof entry === "string") {
      const rule = baseline?.[entry];
      if (rule === undefined) {
        const valid = Object.keys(baseline ?? {});
        const suggest = closestName(entry, new Set(valid));
        throw new SetupError(
          "CONFIG_INVALID",
          `invalid config ${source}: unknown rule name '${entry}'${baseline === undefined ? " - no defaults baseline was provided" : ""}`,
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
      byName.set(entry.name, compileRule(entry, source));
    }
  }
  return byName;
}

/**
 * The custom-rules argument arrives pre-validated: counted toward the non-empty-run guard, never
 * re-validated here. Static types derive from the same schema the boundary checks.
 */
export function validateConfig(
  raw: unknown,
  source: string,
  baseline?: Record<string, Rule>,
  customRules: readonly CustomRule[] = [],
): ResolvedConfig {
  if (!Value.Check(CONFIG_SCHEMA, raw)) throwConfigInvalid(raw, source);
  const parsed = raw as Static<typeof CONFIG_SCHEMA>;
  const byName = resolveRules(parsed.rules, baseline, source);
  for (const name of parsed.disable ?? []) byName.delete(name);
  // A run that would measure nothing is fatal and named: an empty report must never look like
  // success — the resolved set has to be non-empty across both rule forms.
  if (byName.size === 0 && customRules.length === 0) {
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
  if (parsed.secretDenylist !== undefined) resolved.secretDenylist = parsed.secretDenylist;
  if (parsed.inputType !== undefined) resolved.inputType = parsed.inputType;
  if (parsed.apiKey !== undefined) resolved.apiKey = parsed.apiKey;
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
  for (const target of Array.isArray(entry.target) ? entry.target : [entry.target]) {
    assertCaptureAddress(target);
  }
  const isChoice = entry.kind === "choice";
  const handle = compileDataHandle(
    entry.handle,
    entry.name,
    source,
    isChoice,
    isChoice ? (entry.criteria as readonly string[]) : [],
  );
  // Direct optional properties: scope consumers gate on !== undefined, identical for absent and
  // present-undefined (ruleInScope), and the manifest snapshot drops undefined under JSON.
  const scope = {
    include: entry.include,
    exclude: entry.exclude,
  };
  const handleSnapshot = entry.handle;
  if (entry.kind !== "choice") {
    return {
      name: entry.name,
      instructions: entry.instructions,
      criteria: entry.criteria,
      target: entry.target as Rule["target"],
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
    target: entry.target as Rule["target"],
    handle,
    handleData: handleSnapshot,
    ...scope,
  };
}
