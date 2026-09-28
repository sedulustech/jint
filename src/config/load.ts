/**
 * Config loading. jint.config.json is the default; --config names any other (multiple
 * configurations = multiple files, one per purpose).
 *
 * The config file is PLAIN JSON — no comments, no code. TypeBox validates the boundary and its
 * schema doubles as the checked-in jint.schema.json (editor autocomplete via "$schema"); a small
 * generation script (bun run schema) keeps the two from drifting. Handlers in the file are data —
 * typed by the question: choice rules take a score map, noul rules take a fires_when handler (see
 * sensors/handle.ts) — and compile to the internal function form here, at the single data ->
 * function seam, where the cross-field checks (type match, map length, threshold order) live.
 * Validation or parse failure maps to CONFIG_INVALID with joined, positioned messages (design
 * §3.5).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { checkRunKnobs } from "../core/jev/pacer.ts";
import { defaultRules } from "../core/sensors/defaults.ts";
import {
  checkNoulHandler,
  compileNoulHandler,
  compileScoreHandler,
} from "../core/sensors/handle.ts";
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

const LEVEL_SCHEMA = Type.Union([Type.Literal("ok"), Type.Literal("warn"), Type.Literal("error")]);

const SCORE_HANDLER_SCHEMA = Type.Object(
  {
    map: Type.Array(LEVEL_SCHEMA, { minItems: 1 }),
  },
  {
    description:
      "Score handler (choice rules only): one level per criteria entry, indexed by score 0..N. Direction is expressed by the map itself (high-bad: [ok, ok, warn, error]; high-good: [error, warn, ok, ok]). The length MUST equal the criteria count and at least one level must be non-ok. A fired level's finding message defaults to that level's criteria line, prefixed by the element reference.",
  },
);

const NOUL_HANDLER_SCHEMA = Type.Object(
  {
    fires_when: Type.Union([Type.Literal("true"), Type.Literal("false")]),
    warn_at: Type.Number(),
    error_at: Type.Optional(Type.Number()),
    silent_band: Type.Optional(Type.Tuple([Type.Number(), Type.Number()])),
  },
  {
    description:
      "Noul handler (noul rules only): fires_when names the defect pole (REQUIRED, no default); warn_at and error_at are confidence thresholds on the defect pole (P(true) is flipped first when fires_when is false); warn_at < error_at there and both must be within (0, 1). silent_band [lo, hi] keeps defect-pole readings inside it silent (must be ordered, must not cover the whole scale, must not contain the thresholds); absent = everything surfaces.",
  },
);

const HANDLER_SCHEMA = Type.Union([SCORE_HANDLER_SCHEMA, NOUL_HANDLER_SCHEMA]);

// Discriminated on kind: noul rules carry {true,false}, choice rules carry an ordered rubric
// (>= two descriptions indexed by score 0..N). kind is optional in the noul branch so minimal
// configs stay validating (the loader fills the default). "handle": null is the classify-only
// form: the measurement streams, nothing ever produces findings (no default ships it; "handle": null).
const RULE_SCHEMA = Type.Union([
  Type.Object({
    name: Type.String(),
    kind: Type.Optional(Type.Literal("noul")),
    instructions: Type.Optional(Type.String()),
    criteria: Type.Object({ true: Type.String(), false: Type.String() }),
    target: TARGET_SCHEMA,
    handle: Type.Union([HANDLER_SCHEMA, Type.Null()]),
  }),
  Type.Object({
    name: Type.String(),
    kind: Type.Literal("choice"),
    criteria: Type.Array(Type.String(), { minItems: 2 }),
    instructions: Type.String(),
    target: TARGET_SCHEMA,
    handle: Type.Union([HANDLER_SCHEMA, Type.Null()]),
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
  // TS-tier rules: paths to TypeScript rule files (default-exporting defineRule from "jint:api"),
  // resolved relative to the config file. The JSON tier above is untouched by this key.
  tsRules: Type.Optional(Type.Array(Type.String())),
  exclude: Type.Optional(Type.Array(Type.String())),
  disable: Type.Optional(Type.Array(Type.String())),
  apiKey: Type.Optional(Type.String()),
  // Run knobs (see jev/pacer.ts): concurrency = in-flight ceiling, rps_budget = request-start
  // budget. Floors are enforced in validateConfig so the error names the field.
  concurrency: Type.Optional(
    Type.Number({
      description:
        "Max in-flight classifier calls, run-wide (the wall-clock knob). Default 16 (measured: 53.9 rps at 16, zero 429s), max 64.",
    }),
  ),
  rps_budget: Type.Optional(
    Type.Number({
      description:
        "Client-side request-start budget, requests/second (the compliance knob; published quota is 1200 rpm = 20 rps). Default 15 (~75% of quota).",
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
  readonly inputType?: "file" | "dir" | "diff";
  readonly rules: readonly Rule[];
  /** TS-tier rule files, resolved absolute; empty when the config declares none. */
  readonly tsRules?: readonly string[];
  readonly exclude: readonly string[];
  readonly apiKey?: string;
  /** In-flight classifier-call ceiling (the wall-clock knob; default 16, max 64). */
  readonly concurrency?: number;
  /** Client-side request-start budget, requests/second (the compliance knob; default 15). */
  readonly rps_budget?: number;
  /** Per-call classifier timeout, seconds (default 30); a hung call becomes JEV_TIMEOUT. */
  readonly timeout?: number;
}

/** The built-in config used when no config file exists: no input, all default rules. */
export function defaultConfig(): ResolvedConfig {
  return Object.freeze({
    input: "",
    rules: Object.freeze(Object.values(defaultRules)),
    tsRules: Object.freeze([]),
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
    tsRules: string[];
    exclude: string[];
    apiKey?: string;
    concurrency?: number;
    rps_budget?: number;
    timeout?: number;
  } = {
    input: parsed.input ?? "",
    rules: [...byName.values()],
    // Relative TS rule paths resolve against the config file's directory, like the config itself.
    tsRules: (parsed.tsRules ?? []).map((p) => resolve(dirname(resolve(source)), p)),
    exclude: parsed.exclude ?? [],
  };
  if (parsed.inputType !== undefined) resolved.inputType = parsed.inputType;
  if (parsed.apiKey !== undefined) resolved.apiKey = parsed.apiKey;
  // Same validation pass as the handler checks: the error names the exact field. Schema floors
  // (>= 1, > 0) are validated here too so the message names the field, not a union branch.
  const knobProblem = checkRunKnobs({
    concurrency: parsed.concurrency,
    rps_budget: parsed.rps_budget,
    timeout: parsed.timeout,
  });
  if (knobProblem !== null) {
    throw new SetupError("CONFIG_INVALID", `invalid config ${source}: ${knobProblem}`);
  }
  if (parsed.concurrency !== undefined) resolved.concurrency = parsed.concurrency;
  if (parsed.rps_budget !== undefined) resolved.rps_budget = parsed.rps_budget;
  if (parsed.timeout !== undefined) resolved.timeout = parsed.timeout;
  return Object.freeze(resolved);
}

/** The data -> function seam for one rule: validates the handler, compiles, freezes shape. */
function compileRule(entry: Static<typeof RULE_SCHEMA>, source: string): Rule {
  const isChoice = entry.kind === "choice";
  const handle = compileDataHandle(
    entry.handle,
    entry.name,
    source,
    isChoice,
    isChoice ? (entry.criteria as readonly string[]) : [],
  );
  if (entry.kind !== "choice") {
    return {
      name: entry.name,
      instructions: (entry as { instructions?: string }).instructions,
      criteria: entry.criteria,
      target: entry.target,
      handle,
    };
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
 * Null handler = classify-only (never produces findings); otherwise the handler TYPE must match the
 * question type (score map <-> choice, fires_when <-> noul) and its internal invariants hold. Every
 * failure names the rule id and the exact field.
 */
function compileDataHandle(
  handle: Static<typeof HANDLER_SCHEMA> | null,
  name: string,
  source: string,
  isChoice: boolean,
  criteria: readonly string[],
): Rule["handle"] {
  const fail = (field: string, detail: string): never => {
    throw new SetupError(
      "CONFIG_INVALID",
      `invalid config ${source}: rule '${name}' ${field}: ${detail}`,
    );
  };
  if (handle === null) return () => null;
  if ("map" in handle) {
    if (!isChoice) {
      fail(
        "handle.map",
        "a score handler on a noul rule (criteria {true, false}) — noul rules take a fires_when handler",
      );
    }
    if (handle.map.length !== criteria.length) {
      fail(
        "handle.map",
        `map has ${handle.map.length} level(s) but the criteria has ${criteria.length}`,
      );
    }
    if (handle.map.every((level) => level === "ok")) {
      fail("handle.map", "at least one level must be non-ok");
    }
    return compileScoreHandler(handle, criteria);
  }
  if (isChoice) {
    fail(
      "handle.fires_when",
      "a noul handler on a choice rule — choice rules take a score handler ({ map })",
    );
  }
  const problem = checkNoulHandler(handle);
  if (problem !== null) {
    throw new SetupError("CONFIG_INVALID", `invalid config ${source}: rule '${name}' ${problem}`);
  }
  return compileNoulHandler(handle);
}
