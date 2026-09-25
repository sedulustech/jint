/**
 * Config loading. jint.config.json is the default; --config names any other (multiple
 * configurations = multiple files, one per purpose).
 *
 * The config file is PLAIN JSON — no comments, no code. TypeBox validates the boundary and its
 * schema doubles as the checked-in jint.schema.json (editor autocomplete via "$schema"); a small
 * generation script (bun run schema) keeps the two from drifting. Handles in the file are data
 * (warn_at/error_at, polarity inferred from ordering — see sensors/handle.ts) and compile to the
 * internal function form here, at the single data -> function seam. Validation or parse failure
 * maps to CONFIG_INVALID with joined, positioned messages (design §3.5).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { defaultRules } from "../core/sensors/defaults.ts";
import { compileHandle } from "../core/sensors/handle.ts";
import { SetupError, type Rule } from "../core/types.ts";

export const DEFAULT_CONFIG_PATH = "jint.config.json";

const KIND_SCHEMA = Type.Union([Type.Literal("file"), Type.Literal("dir"), Type.Literal("diff")]);

const TARGET_SCHEMA = Type.Union([
  Type.Literal("files"),
  Type.Literal("functions"),
  Type.Literal("definitions"),
  Type.Literal("comments"),
  Type.Literal("imports"),
  Type.Literal("diffs"),
]);

const HANDLE_SCHEMA = Type.Object(
  {
    warn_at: Type.Number(),
    error_at: Type.Number(),
  },
  {
    description:
      "Rule thresholds as data; polarity is inferred from their ordering. warn_at < error_at means high-bad (a value above warn_at warns, above error_at errors); error_at < warn_at means high-good (a value below warn_at warns, below error_at errors). Both required; they must differ.",
  },
);

// Discriminated on kind: noul rules carry {true,false}, choice rules carry an ordered rubric
// (>= two descriptions indexed by score 0..N). kind is optional in the noul branch so minimal
// configs stay validating (the loader fills the default). "handle": null is the measure-only
// form: the measurement streams, nothing ever produces findings (no default ships it; "handle": null).
const RULE_SCHEMA = Type.Union([
  Type.Object({
    name: Type.String(),
    kind: Type.Optional(Type.Literal("noul")),
    criteria: Type.Object({ true: Type.String(), false: Type.String() }),
    target: TARGET_SCHEMA,
    handle: Type.Union([HANDLE_SCHEMA, Type.Null()]),
  }),
  Type.Object({
    name: Type.String(),
    kind: Type.Literal("choice"),
    criteria: Type.Array(Type.String(), { minItems: 2 }),
    instructions: Type.String(),
    target: TARGET_SCHEMA,
    handle: Type.Union([HANDLE_SCHEMA, Type.Null()]),
  }),
]);

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
  exclude: Type.Optional(Type.Array(Type.String())),
  disable: Type.Optional(Type.Array(Type.String())),
  apiKey: Type.Optional(Type.String()),
});

/** The normalized shape every config resolves to before lint runs. */
export interface ResolvedConfig {
  readonly input?: string;
  readonly inputType?: "file" | "dir" | "diff";
  readonly rules: readonly Rule[];
  readonly exclude: readonly string[];
  readonly apiKey?: string;
}

/** The built-in config used when no config file exists: no input, all default rules. */
export function defaultConfig(): ResolvedConfig {
  return Object.freeze({
    input: "",
    rules: Object.freeze(Object.values(defaultRules)),
    exclude: Object.freeze(["**/fixtures/**"]),
  });
}

export async function loadConfig(path = DEFAULT_CONFIG_PATH): Promise<ResolvedConfig> {
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
  return validateConfig(raw, path);
}

/** Validates the boundary shape, compiles data handles; static types derive from the same schema. */
export function validateConfig(raw: unknown, source: string): ResolvedConfig {
  if (!Value.Check(CONFIG_SCHEMA, raw)) {
    const messages = [...Value.Errors(CONFIG_SCHEMA, raw)]
      .map((err) => `${err.path === "" ? "/" : err.path} ${err.message}`)
      .join("; ");
    throw new SetupError("CONFIG_INVALID", `invalid config ${source}: ${messages}`);
  }
  const parsed = raw as Static<typeof CONFIG_SCHEMA>;
  // No rules key = the default rule set; entries select a default by name or declare a full rule
  // (last wins per name). disable removes by name afterwards — set membership, not policy.
  const byName = new Map<string, Rule>();
  if (parsed.rules === undefined) {
    for (const rule of Object.values(defaultRules)) byName.set(rule.name, rule);
  } else {
    for (const entry of parsed.rules) {
      if (typeof entry === "string") {
        const rule = defaultRules[entry];
        if (rule === undefined) {
          throw new SetupError(
            "CONFIG_INVALID",
            `invalid config ${source}: unknown default rule name '${entry}'`,
          );
        }
        byName.set(entry, rule);
      } else {
        byName.set(entry.name, compileRule(entry, source));
      }
    }
  }
  for (const name of parsed.disable ?? []) byName.delete(name);
  const resolved: {
    input: string;
    inputType?: Static<typeof KIND_SCHEMA>;
    rules: Rule[];
    exclude: string[];
    apiKey?: string;
  } = {
    input: parsed.input ?? "",
    rules: [...byName.values()],
    exclude: parsed.exclude ?? [],
  };
  if (parsed.inputType !== undefined) resolved.inputType = parsed.inputType;
  if (parsed.apiKey !== undefined) resolved.apiKey = parsed.apiKey;
  return Object.freeze(resolved);
}

/** The data -> function seam for one rule: validates the handle pair, compiles, freezes shape. */
function compileRule(entry: Static<typeof RULE_SCHEMA>, source: string): Rule {
  const handle = compileDataHandle(entry.handle, entry.name, source);
  if (entry.kind !== "choice") {
    return { name: entry.name, criteria: entry.criteria, target: entry.target, handle };
  }
  return {
    name: entry.name,
    kind: "choice",
    criteria: entry.criteria as [string, string, ...string[]],
    instructions: (entry as { instructions: string }).instructions,
    target: entry.target,
    handle,
  };
}

/**
 * Null handle = measure-only (never produces findings); otherwise both thresholds must exist and
 * differ.
 */
function compileDataHandle(
  handle: Static<typeof HANDLE_SCHEMA> | null,
  name: string,
  source: string,
): Rule["handle"] {
  if (handle === null) return () => null;
  if (handle.warn_at === handle.error_at) {
    throw new SetupError(
      "CONFIG_INVALID",
      `invalid config ${source}: rule '${name}' handle thresholds must differ (warn_at = error_at = ${handle.warn_at})`,
    );
  }
  return compileHandle(handle);
}
