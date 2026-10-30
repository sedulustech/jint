#!/usr/bin/env bun
/**
 * Jint CLI — the terminal as SDK client (design §4).
 *
 * Exit codes (computed once, here, TYPE-driven): 0 clean 1 error-severity findings 2 SetupError
 * (usage/config: bad flags, CONFIG_INVALID, ENTRYPOINT__, LIST__) 3 InternalError 4 an escaped
 * ClassifyError (the run happened but classified nothing — CI never passes an unclassified or
 * half-classified run)
 *
 * Stream discipline (clig): stdout carries findings — the report and its summary; stderr carries
 * the run's own errors and diagnostics — setup failures, failed units — plus structured logs
 * (default silent; --debug). Every stderr line routes through emit(), the one writer of the `jint:
 * ` prefix; the SDK's strings arrive unprefixed. Either stream stays usable with the other
 * discarded.
 */

import { existsSync, fstatSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  ClassifyError,
  InternalError,
  SetupError,
  noRulesAdvice,
  captureFor,
  checkRunKnobs,
  collectReport,
  runsBase,
  selectRules,
  validateRuleSelection,
  assertEndpointKey,
  knownLanguages,
  lint,
  loadConfig,
  renderJson,
  renderInputSummary,
  walkScopes,
  renderLines,
  recordSummary,
  recordRunManifest,
  recordRunReport,
  findConfigFile,
  selectionEcho,
  selectedElements,
  startUi,
  type InputKind,
  type LintReport,
  type ResolvedConfig,
  type SelectedElement,
} from "@jint/sdk";
import { Type as TypeBoxType } from "@sinclair/typebox";
import { Value as TypeBoxValue } from "@sinclair/typebox/value";
import packageJson from "../package.json";
import { catalog, provideVirtualModules } from "./baseline.ts";
import { log, setLogLevel } from "./logger.ts";
import {
  captureJson,
  captureLines,
  emit,
  printSelection,
  emitLines,
  providerLog,
  printRules,
  printRulesJson,
  printRulesStdout,
  usageError,
} from "./output.ts";

/**
 * The flag table — the ONE source for the flag vocabulary. Every projection is a mechanical map
 * over this table: the TypeBox parser schema (value types), parseArgs' options spec, KNOWN_FLAGS
 * (names + aliases), VALUED_FLAGS (type !== "boolean"), and the help Options section (arg + blurb).
 * `type` is the value shape: "boolean" flags take no value; "string" takes ONE value per
 * occurrence; "string[]" ACCUMULATES one value per occurrence (--rule a --rule b). `arg` is the
 * help-display placeholder for the value token; `aliases` are single-char dash aliases.
 */
export const FLAGS = {
  "--language": {
    type: "string",
    arg: "<id>",
    blurb: `tree-sitter grammar for piped-stdin/extensionless sources; valid ids: ${knownLanguages().join(", ")} (derived from the grammar map). Without a resolvable language, inventory-scoped rules fail WALK_FAILED in-band and unit-scoped rules still classify`,
  },
  "--config": {
    type: "string",
    arg: "<path>",
    blurb:
      'config file (auto-discovered: jint.config.ts or jint.config.json; JSON autocomplete via the "$schema" key)',
  },
  "--exclude": {
    type: "string[]",
    arg: "<glob>",
    blurb: "input exclusion, on top of config (repeatable)",
  },
  "--disable": {
    type: "string[]",
    arg: "<name>",
    blurb: "rule removal by name, on top of config (repeatable)",
  },
  "--rule": {
    type: "string[]",
    arg: "<name>",
    blurb:
      "run: ONLY these rules (repeatable; overrides --disable). capture: ONE name - preview the population it will judge, marked with * (nothing is classified)",
  },
  "--concurrency": {
    type: "string",
    arg: "<n>",
    blurb:
      "max in-flight classifier calls, run-wide (default 16, max 64; overrides the config key of the same name)",
  },
  "--timeout": {
    type: "string",
    arg: "<secs>",
    blurb:
      "per-call classifier timeout (default 30; a hung call becomes a per-element PROVIDER_TIMEOUT failure - liveness, not retry)",
  },
  "--queries": {
    type: "string",
    arg: "<file.scm>",
    blurb:
      "capture only: the .scm file that drives extraction, replacing the grammar's own queries.scm",
    verbs: ["capture"],
  },
  "--grammar": {
    type: "string",
    arg: "<dir>",
    blurb:
      "capture only: a grammar dir (<id>.wasm + extensions.json [+ queries.scm]) registered custom for this call",
    verbs: ["capture"],
  },
  "--json": {
    type: "boolean",
    blurb: "machine report (byte-identical to the run's report.json) instead of raw finding lines",
  },
  "--dry-run": {
    type: "boolean",
    blurb:
      "print the rule set that WOULD run (config resolved, disable/only applied) and exit 0 - zero input walks, zero classifier calls",
  },
  "--no-cache": {
    type: "boolean",
    blurb:
      "run: ask every question instead of serving stored answers (the answer cache is $JINT_CACHE_DIR, else ~/.jint/cache)",
    verbs: ["run"],
  },
  "--debug": { type: "boolean", blurb: "structured debug logs on stderr" },
  "--help": { type: "boolean", aliases: ["-h"], blurb: "this help" },
  "--version": { type: "boolean", blurb: "print the version" },
} as const;

/** CLI args boundary - the schema is DERIVED from FLAGS, never a second hand-written shape. */
export const CLI_ARGS_SCHEMA = TypeBoxType.Object(
  Object.fromEntries(
    Object.entries(FLAGS).map(([name, flag]) => [
      name.slice(2),
      flag.type === "boolean"
        ? TypeBoxType.Optional(TypeBoxType.Boolean())
        : flag.type === "string[]"
          ? TypeBoxType.Optional(TypeBoxType.Array(TypeBoxType.String()))
          : TypeBoxType.Optional(TypeBoxType.String()),
    ]),
  ),
);

/**
 * The parsed args' static view, derived from the same table in the type system: "string[]" ->
 * string[], "string" -> string, "boolean" -> boolean; every key optional (parseArgs omits unset
 * flags). The schema above and this type are both projections of FLAGS — they cannot drift.
 */
type CliArgs = {
  [K in keyof typeof FLAGS as K extends `--${infer Name}`
    ? Name
    : never]?: (typeof FLAGS)[K]["type"] extends "string[]"
    ? string[]
    : (typeof FLAGS)[K]["type"] extends "string"
      ? string
      : boolean;
};

/**
 * ParseArgs' options spec, derived from FLAGS: value flags take one token per occurrence;
 * "string[]" accumulates (values: string[]); a single-char alias becomes parseArgs' short.
 */
const PARSE_ARGS_OPTIONS: {
  [name: string]: { type: "string" | "boolean"; multiple?: boolean; short?: string };
} = Object.fromEntries(
  Object.entries(FLAGS).map(([name, flag]) => [name.slice(2), parseArgsOptionsSpec(flag)]),
);

/**
 * ParseArgs' options spec for one flag, branched whole literals: the declared return type puts each
 * literal under excess-property checking, and parseArgs keys on multiple/short, so a
 * present-undefined key must not be produced.
 */
function parseArgsOptionsSpec(flag: (typeof FLAGS)[keyof typeof FLAGS]): {
  type: "string" | "boolean";
  multiple?: boolean;
  short?: string;
} {
  const type = flag.type === "boolean" ? ("boolean" as const) : ("string" as const);
  if ("aliases" in flag) return { type, short: (flag.aliases as readonly string[])[0]!.slice(1) };
  if (flag.type === "string[]") return { type: "string", multiple: true };
  return { type };
}

/**
 * One aligned two-column help block: the left column pads to the widest entry, the right column
 * wraps on spaces at the terminal width with continuations indented to the left column.
 */
function helpRows(rows: readonly { left: string; right: string }[]): string {
  const leftWidth = Math.max(...rows.map((row) => row.left.length)) + 2;
  const textWidth = 100 - (leftWidth + 2);
  return rows
    .map((row) => {
      const lines: string[] = [];
      let line = "";
      for (const word of row.right.split(" ")) {
        const candidate = line === "" ? word : `${line} ${word}`;
        if (line !== "" && candidate.length > textWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line !== "") lines.push(line);
      const indent = " ".repeat(leftWidth + 2);
      return lines
        .map((text, i) => (i === 0 ? `  ${row.left.padEnd(leftWidth)}${text}` : `${indent}${text}`))
        .join("\n");
    })
    .join("\n");
}

/** The Options section, derived: alias + name + value placeholder in the left column, blurb right. */
const OPTION_ROWS = Object.entries(FLAGS).map(([name, flag]) => ({
  left:
    ("aliases" in flag ? `${flag.aliases[0]}, ` : "") +
    name +
    ("arg" in flag ? ` ${flag.arg}` : ""),
  right: flag.blurb,
}));

/**
 * The verb table — the ONE source for the command vocabulary and the position rule: the FIRST
 * positional IS the command (run, serve, capture); the rest are its operands. There is no implicit
 * verb: a missing or unknown first positional is a usage error naming `jint run <operands>`. Verbs
 * never resolve to paths (a verb token as a later positional is an error; the path is reached as
 * ./<name>). `flags` names the flags the verb accepts beyond the global three (--help, --version,
 * --debug); run takes every unmarked flag (a flag may carry its own `verbs` marker in FLAGS —
 * --queries and --grammar are capture's). `example`/`blurb` render into the help Usage section.
 */
export const VERBS = {
  run: {
    example: "jint run src/",
    blurb:
      "classify an input: paths, the str/paths stdin nouns, or the discovered config; needs OPENAI_API_KEY (or JINT_API_KEY with JINT_API_URL) in the environment",
  },
  serve: {
    example: "jint serve",
    blurb:
      "the run UI over the store's newest run - hold, Ctrl+C to exit; binds loopback only (override: JINT_UI_HOST - a non-loopback host is your trust decision, a port in it is rejected); honors JINT_UI_PORT",
    flags: [],
  },
  capture: {
    example: "jint capture doc.md",
    blurb:
      "print extraction - grammar, kind, span, name - with the classifier unplugged; loads the config like run (its input when no target, its excludes always); an explicit FILE target bypasses the config's include/exclude walk scoping (a dir target never does) - capture prints structure, no classifier, while run's file operand evaluates the config scope for unscoped rules",
    flags: ["json", "queries", "grammar", "config", "exclude", "rule"],
  },
} as const;

/** Any verb name, for table-derived types. */
export type Verb = keyof typeof VERBS;

/**
 * The Usage section's verb example rows, derived from the same table dispatch reads. run carries no
 * `flags` list (the whole unmarked flag table applies); verbFlagProblem is the scope check.
 */
const VERB_ROWS = Object.values(VERBS).map((verb) => ({
  left: verb.example,
  right: verb.blurb,
}));

/**
 * Resolve the verb off the positionals, exactly one level: the FIRST positional must be in the
 * table — it is the command, and everything after it is the verb's operands. Null when it is not
 * (or there is no positional at all): there is NO implicit verb; the caller reports the usage error
 * naming the `jint run <operands>` form.
 */
export function resolveVerb(positionals: readonly string[]): { name: Verb; rest: string[] } | null {
  const first = positionals[0];
  if (first !== undefined && Object.hasOwn(VERBS, first))
    return { name: first as Verb, rest: positionals.slice(1) };
  return null;
}

/** The flags every verb takes: help, version, debug. */
const GLOBAL_FLAGS: ReadonlySet<string> = new Set(["help", "version", "debug"]);

/**
 * A flag the invocation's verb does not take, or null. Two halves, both table-driven: a flag's own
 * `verbs` marker (FLAGS) may exclude verbs even run; a verb's `flags` list (VERBS) admits beyond
 * the global three, and run (no list) takes every unmarked flag. Loud, naming the flag — a parsed
 * flag that silently does nothing is a failure mode, not a convenience.
 */
export function verbFlagProblem(verb: Verb, cliArgs: CliArgs): string | null {
  const admitted = (VERBS[verb] as { flags?: readonly string[] }).flags;
  for (const key of Object.keys(cliArgs) as (keyof CliArgs & string)[]) {
    if (cliArgs[key] === undefined || GLOBAL_FLAGS.has(key)) continue;
    const entry = (FLAGS as Record<string, { verbs?: readonly string[] }>)[`--${key}`];
    if (entry?.verbs !== undefined && !entry.verbs.includes(verb))
      return `--${key} is a ${entry.verbs.join("/")} flag - see jint --help`;
    if (admitted !== undefined && !admitted.includes(key))
      return `--${key} does not apply to ${verb} - see jint --help`;
  }
  return null;
}

/**
 * The noun table — the ONE source for the noun vocabulary and the position rule: a noun is the
 * FIRST positional INSIDE run's payload, its next positional is the payload — exactly `payload`
 * ("-", the declared stdin read; there is no inline payload) — and nothing follows the payload.
 * Dispatch reads this table; no per-noun branch may exist. `example`/`blurb` render into the help
 * Usage section; `hint` names the remedy when a payload arrives in a now-dead form. str and paths
 * are INPUT nouns — they declare how run reads piped stdin; there are no others, and capture and
 * serve take none (no stdin interaction).
 */
export const NOUNS = {
  str: {
    payload: "-",
    example: "cat snippet.ts | jint run str -",
    blurb: "piped stdin, one str unit",
  },
  paths: {
    payload: "-",
    example: "git diff --name-only HEAD~1 | jint run paths -",
    blurb: "a path LIST from piped stdin",
    hint: "a list file is piped: jint run paths - < list.txt",
  },
} as const;

/** The Usage section's noun rows, derived from the same table dispatch reads. */
const NOUN_ROWS = Object.values(NOUNS).map((noun) => ({ left: noun.example, right: noun.blurb }));

/** "jint run str - = piped stdin, one str unit; jint run paths - = a path LIST from piped stdin" */

/** "jint run str - (piped stdin, one str unit) or jint run paths - (a path LIST from piped stdin)" */
const NOUN_FORMS = Object.entries(NOUNS)
  .map(([name, noun]) => `jint run ${name} ${noun.payload} (${noun.blurb})`)
  .join(" or ");

/**
 * ONE dash-positional vocabulary, used by BOTH scan sites (the first-positional check in runCli and
 * the operand scan in resolveCliInput): a bare '-' names the input-noun forms (a dash is a payload,
 * a payload needs its noun); anything else dash-leading and unresolvable is a mistyped flag - name
 * the token.
 */
function dashPositionalError(token: string): string {
  if (token === "-") return `bare '-' is undeclared - name the noun: ${NOUN_FORMS}`;
  return `unknown option or missing path '${token}' - see jint --help`;
}

/** The full help text; the Options section is DERIVED from FLAGS. Exported for the derivation tests. */
export const HELP = `jint  - lint by AI-classifier judgments (formerly calibrated on jev): classifies code with AI-classifier judgments; rules in, findings out.

Usage:
${helpRows([
  ...VERB_ROWS,
  ...NOUN_ROWS,
  { left: "jint run", right: "no operand: input comes from the discovered config" },
])}

Verbs - the FIRST positional IS the command (run, serve, capture); everything after it is the
verb's operands. There is no implicit verb: a missing or unknown first positional is a usage
error naming the jint run form.

Nouns - str and paths are run's INPUT nouns; the noun is the FIRST positional of the run
payload, its next positional is the payload, and nothing follows the payload:
  jint run str -                 one str unit from piped stdin
  jint run paths -               a path LIST from piped stdin (jint run paths - < list.txt)
  jint run src/a.ts              a path: dir if a directory, else file - never content-sniffed
  jint run -- --weird.ts         -- ends flag parsing for dash-paths
Nouns never resolve to paths (a file named str: jint run ./str); anything after a
noun's payload is a usage error naming the correct form.

Element-scoped runs - address one element directly:
  jint run src/a.ts@L58          the element whose span contains line 58 (one call)
  jint run src/a.ts@L58-L70      every element FULLY ENCLOSED in [s,e] (comma list: each item
                                 independent; a range enclosing none is an error naming the
                                 file's element spans)
Finding lines paste back as file@L<line> (or file@L<start>-L<end> for a multi-line element) -
element ids are never selectable; a finding's @L is pre-edit (edits shift lines): re-check at the
CURRENT line.

Options:
${helpRows(OPTION_ROWS)}

Exit codes: 0 clean, 1 error findings, 2 usage/config, 3 internal, 4 zero measurements.

`;

/** The `valid:` list cap: at most six names, then ` ...` ONLY when names were cut. */
const VALID_LIST_CAP = 6;

/**
 * The rendered line for a thrown error: the message leads, structured segments follow on " - "
 * separators (the flag-origin label, the capped valid list, a did-you-mean), no em-dashes. The
 * invalid-rule detail replaces the schema prose with the one line that names the rule and field;
 * the full joined TypeBox message stays in the debug log.
 */
function thrownLine(error: SetupError | InternalError | ClassifyError, origin?: string): string {
  if (error instanceof InternalError)
    return `internal: ${error.message} - rerun with --debug; if it persists, report it`;
  const detail = error instanceof SetupError ? error.detail : undefined;
  if (detail === undefined) return error.message;
  if (detail.kind === "invalid-rule")
    return detail.present
      ? `invalid rule #${detail.ruleIndex}: invalid "${detail.field}" - see the config example in README`
      : `invalid rule #${detail.ruleIndex}: missing "${detail.field}" - see the config example in README`;
  // The origin label rides ON the message (parenthesized, space-joined), never on a hyphen: the
  // example shape is `unknown rule "x" (--rule) - valid: ...`.
  const segments = [origin !== undefined ? `${error.message} ${origin}` : error.message];
  if (detail.valid.length > 0) {
    const capped = detail.valid.slice(0, VALID_LIST_CAP).join(", ");
    segments.push(`valid: ${capped}${detail.valid.length > VALID_LIST_CAP ? " ..." : ""}`);
  }
  if (detail.kind === "unknown-rule" && detail.suggest !== undefined)
    segments.push(`did you mean: ${detail.suggest}`);
  return segments.join(" - ");
}

/**
 * The CLI-side origin label for an unknown-rule detail: which flag filled the unknown name. The SDK
 * detail carries no flags; the CLI derives the label from its own flag state, mirroring
 * validateRuleSelection's disable-then-only order. Config-origin errors get no label.
 */
function ruleOriginLabel(args: CliArgs, config: ResolvedConfig): string | undefined {
  const known = new Set([...config.rules, ...(config.customRules ?? [])].map((r) => r.name));
  const firstUnknown = (names: readonly string[] | undefined) =>
    names?.find((name) => !known.has(name));
  if (firstUnknown(args.disable) !== undefined) return "(--disable)";
  if (firstUnknown(args.rule) !== undefined) return "(--rule)";
  return undefined;
}

/**
 * The end-of-run stderr notice for run recording: where the requests went and how many — the
 * UNPREFIXED emitter message (the prefix is emit's). Empty when nothing was recorded. Recording is
 * always on — JINT_RUNS_DIR only moves where run dirs land; the notice always reports, even zero
 * requests (the run may have failed before any classifier call).
 */
export function recordNotice(): string {
  const record = recordSummary();
  if (record === null) return "";
  const override = record.override ? " (override: JINT_RUNS_DIR)" : "";
  const cached = record.cached > 0 ? `, ${record.cached} answers from the cache` : "";
  return `requests -> ${record.dir} (${record.count} calls${cached})${override}`;
}
/**
 * Input resolution precedence: command noun > stdin > config.input > error. A positional path's
 * kind is inferred by shape (exists-as-dir -> dir, else file); piped stdin is DECLARED by a noun,
 * never guessed. Usage errors print and return the usage outcome; the caller maps it to exit 2. See
 * runCli for the TTY/fall-through contract this preserves.
 */
async function resolveCliInput(positionals: readonly string[]): Promise<
  | { outcome: "usage" }
  | {
      outcome: "ok";
      stdinStr: { content: string } | undefined;
      lintInput: { input: string | string[]; inputType?: InputKind } | undefined;
      elementScope: FileSelector | undefined;
      pathsContent: string | undefined;
    }
> {
  let stdinStr: { content: string } | undefined;
  let lintInput: { input: string | string[]; inputType?: InputKind } | undefined;
  let elementScope: FileSelector | undefined;
  // The paths noun's payload: always '-' (stdin). The CLI does the read HERE (I/O at the
  // boundary that owns it) and hands lint() the already-read text, like str's content.
  let pathsContent: string | undefined;
  const firstPositional = positionals[0];
  // The grammar, read off the NOUNS table in one place: a noun is the FIRST positional of run's
  // payload, its next positional is the payload — '-' and nothing else — and nothing follows the payload. The noun
  // declares how stdin is read; there is no inline payload to protect from flag parsing.
  const nounName =
    firstPositional !== undefined && Object.hasOwn(NOUNS, firstPositional)
      ? (firstPositional as keyof typeof NOUNS)
      : undefined;
  if (nounName !== undefined) {
    const noun = NOUNS[nounName];
    const payload = positionals[1];
    if (payload === undefined) {
      usageError(
        `jint run ${nounName} expects a payload  - use: jint run ${nounName} ${noun.payload}`,
      );
      return { outcome: "usage" as const };
    }
    if (payload !== noun.payload) {
      const hint = "hint" in noun ? ` (${noun.hint})` : "";
      usageError(
        `'${payload}' is not a payload  - jint run ${nounName} reads piped stdin: jint run ${nounName} ${noun.payload}, and nothing follows it${hint}`,
      );
      return { outcome: "usage" as const };
    }
    if (positionals.length > 2) {
      usageError(
        `nothing may follow the payload  - jint run ${nounName} ${noun.payload} is the whole input declaration (one noun per run)`,
      );
      return { outcome: "usage" as const };
    }
    if (process.stdin.isTTY) {
      usageError(
        `jint run ${nounName} ${noun.payload}: no piped stdin to read (stdin is a terminal)`,
      );
      return { outcome: "usage" as const };
    }
    // Nouns never resolve to filesystem paths (a repo file named 'str' is reached as ./str).
    if (nounName === "str") stdinStr = { content: await Bun.stdin.text() };
    // the path list: read NOW (the SDK takes the text; no lazy spec resolution behind lint()).
    // A read failure propagates: runCli maps it to the exit code at its boundary.
    else pathsContent = await readStdinList();
  } else if (positionals.length > 0) {
    // File positionals: files may be many; a directory is exactly one path (the walk owns its
    // tree). A noun anywhere but FIRST is a misplaced declaration, and it is checked before
    // anything else. ONE consistent unknown-option rule next: a dash-leading positional that is
    // no known flag and no existing path is a mistyped flag (or a flag whose `--` separator the
    // bun runtime consumed) — say so, naming the token. An existing dash-leading file stays a
    // path, reachable verbatim after `--`.
    for (const positional of positionals) {
      if (Object.hasOwn(VERBS, positional)) {
        usageError(
          `a verb is the FIRST positional  - a path named '${positional}' is reached as ./${positional} (or after --)`,
        );
        return { outcome: "usage" as const };
      }
    }
    for (const positional of positionals) {
      if (Object.hasOwn(NOUNS, positional)) {
        usageError(
          `a noun is the FIRST positional of the run payload  - use: jint run ${positional} ${NOUNS[positional as keyof typeof NOUNS].payload}`,
        );
        return { outcome: "usage" as const };
      }
    }
    for (const positional of positionals) {
      if (positional === "-" || (positional.startsWith("-") && !existsSync(positional))) {
        usageError(dashPositionalError(positional));
        return { outcome: "usage" as const };
      }
    }
    if (positionals.length > 1) {
      try {
        if (statSync(positionals[0]!).isDirectory()) {
          usageError(`a directory is one path  - use: jint run ${positionals[0]}`);
          return { outcome: "usage" as const };
        }
      } catch {
        // first positional not stat-able: file list — fileUnit reports ENTRYPOINT_NOT_FOUND
      }
    }
    // Element selector on a file noun (path@L<n>): exactly one selected file, judged as one
    // element. A selector on multiple positionals or on a directory is a caller contradiction —
    // say so before any input is touched.
    const selectors = positionals.map((p) => parseFileSelector(p));
    const pasted = selectors.find((sel) => sel.pastedId === true);
    if (pasted !== undefined) {
      usageError(
        `element ids are run-scoped and cannot select across runs  - query by file@L, e.g. jint run ${pasted.path.split("#")[0]}@L58`,
      );
      return { outcome: "usage" as const };
    }
    const bad = selectors.find((sel) => sel.badRange !== undefined);
    if (bad !== undefined) {
      usageError(
        `bad line span "${bad.path}@${bad.badRange}" - use @L<line> or @L<start>-<end>,... with start <= end (see jint --help)`,
      );
      return { outcome: "usage" as const };
    }
    const selected = selectors.filter(
      (sel) => sel.anchor !== undefined || sel.ranges !== undefined,
    );
    if (selected.length > 1) {
      usageError("one element selector per run  - select from a single file");
      return { outcome: "usage" as const };
    }
    if (selected.length === 1) {
      const sel = selected[0]!;
      if (selectors.length > 1) {
        usageError(
          `an element selector selects one file  - classify the others separately: jint run ${sel.path}`,
        );
        return { outcome: "usage" as const };
      }
      if (existsSync(sel.path) && statSync(sel.path).isDirectory()) {
        usageError(`${sel.path} is a directory  - element selectors take files`);
        return { outcome: "usage" as const };
      }
      elementScope = sel;
      lintInput = { input: sel.path };
    } else {
      // shape inference: exists-as-dir -> dir, else file
      lintInput =
        positionals.length === 1
          ? { input: positionals[0]! }
          : { input: [...positionals], inputType: "file" };
    }
  }
  // Undeclared stdin is never read: a pipe may never close (CI, editors, agents), so reading it
  // would hang. A redirected file is checked without reading - a non-empty one is a usage error.
  if (
    stdinStr === undefined &&
    lintInput === undefined &&
    pathsContent === undefined &&
    !process.stdin.isTTY
  ) {
    const stdin = fstatSync(0);
    if (stdin.isFile() && stdin.size > 0) {
      usageError(
        "piped stdin needs a kind  - use: jint run str - (one source snippet) or jint run paths - (a path list: git diff --name-only HEAD~1 | jint run paths -)",
      );
      return { outcome: "usage" as const };
    }
  }

  return {
    outcome: "ok",
    stdinStr,
    lintInput,
    elementScope,
    pathsContent,
  };
}

/** The config capture runs under when no config file exists: no rules, the usual fixtures exclude. */
function structureOnlyConfig(): ResolvedConfig {
  return Object.freeze({
    input: "",
    rules: Object.freeze([]),
    customRules: Object.freeze([]),
    include: Object.freeze([]),
    exclude: Object.freeze(["**/fixtures/**"]),
  }) as unknown as ResolvedConfig;
}

/**
 * The CLI's ONE config scope, shared by run and capture: --config > discovered jint.config.*,
 * loaded through the SDK loader with the bundled rule catalog (string rule names resolve), so both
 * verbs see the same rules, input, and excludes - and a config that cannot load fails identically
 * through either verb. No config file is an error that lists the rule domains: jint runs nothing
 * the config does not name. Capture classifies nothing, so it needs no rules: with no config file
 * it gets the structure-only config, and a config without rules loads. configPath is the file that
 * ran (absolute), null for the structure-only config.
 */
async function loadCliConfig(
  cliArgs: CliArgs,
  needsRules = true,
): Promise<{
  resolvedConfig: ResolvedConfig;
  configPath: string | null;
}> {
  const foundConfig = cliArgs.config !== undefined ? resolve(cliArgs.config) : findConfigFile();
  if (foundConfig === null && !needsRules) {
    return { resolvedConfig: structureOnlyConfig(), configPath: null };
  }
  if (foundConfig === null) {
    throw new SetupError(
      "CONFIG_NO_RULES",
      `no jint config found - jint runs only the rules a config names; create jint.config.ts (or jint.config.json) or pass --config; ${noRulesAdvice()}`,
    );
  }
  return {
    resolvedConfig: await loadConfig(foundConfig, { catalog, rulesOptional: !needsRules }),
    configPath: foundConfig,
  };
}

/**
 * The config-scope basis for one input path, derived from the config's location: the walk root
 * relative to the config's directory, so the config's scope patterns apply no matter where the walk
 * starts (git parity). Undefined when no config file ran or the input escapes the config's
 * directory. One derivation, two verbs (run and capture) - the mechanism is shared, not repeated.
 */
function configScopeBase(configPath: string | null, input: string): string | undefined {
  if (configPath === null || input.startsWith("/")) return undefined;
  const base = relative(dirname(configPath), resolve(input));
  return base.startsWith("..") ? undefined : base;
}

export async function runCli(cliArgv: string[]): Promise<number> {
  provideVirtualModules();
  const parsedCliArgs = parseCliArgs(cliArgv);
  if (parsedCliArgs.outcome === "usage-error") {
    usageError(parsedCliArgs.usageMessage);
    return 2;
  }
  const cliArgs = parsedCliArgs.cliArgs;

  if (cliArgs.help === true) {
    process.stdout.write(HELP);
    return 0;
  }
  if (cliArgs.version === true) {
    process.stdout.write(`${packageJson.version}\n`);
    return 0;
  }
  // The dash-leading rule runs on the FIRST positional before the verb check, so a mistyped
  // flag (jint --frobnicate a.ts) reports the token, not a verb complaint; a bare '-' names the
  // input-noun forms. An existing dash-leading path stays a path (run reaches it after `--`).
  const firstPositional = parsedCliArgs.positionals[0];
  if (
    firstPositional !== undefined &&
    firstPositional.startsWith("-") &&
    !existsSync(firstPositional)
  ) {
    usageError(dashPositionalError(firstPositional));
    return 2;
  }
  // Verb resolution, exactly one level: the FIRST positional IS the command. No implicit verb -
  // a missing or unknown first positional is a usage error naming the `jint run` form.
  const verb = resolveVerb(parsedCliArgs.positionals);
  if (verb === null) {
    const operands = parsedCliArgs.positionals.join(" ");
    usageError(
      operands === ""
        ? "a verb is required  - use: jint run (input from the discovered config), jint serve, jint capture <path> - see jint --help"
        : `'${operands}' is not a verb  - use: jint run ${operands} (verbs: run, serve, capture - see jint --help)`,
    );
    return 2;
  }
  if (cliArgs.debug === true) setLogLevel("debug");
  // The flat flag set parses whole, for every verb; a flag the verb does not take is a LOUD usage
  // error naming it, never a silent no-op (clig: never ignore what you cannot honor).
  const scopeProblem = verbFlagProblem(verb.name, cliArgs);
  if (scopeProblem !== null) {
    usageError(scopeProblem);
    return 2;
  }
  if (verb.name === "serve") return serveVerb(verb.rest);
  if (verb.name === "capture") return captureVerb(cliArgs, verb.rest);
  // An unknown grammar is a usage error before any input is touched: the run would stream
  // WALK_FAILED for the unit and still exit clean. Same code and detail as the SDK's
  // unknown-language throws, so a flag-named language and an SDK-resolved one render alike.
  if (cliArgs.language !== undefined && !knownLanguages().includes(cliArgs.language)) {
    return exitForThrown(
      new SetupError("MISSING_GRAMMAR", `unknown language '${cliArgs.language}'`, {
        detail: { kind: "unknown-language", valid: knownLanguages() },
      }),
    );
  }

  // config discovery: TS preferred, JSON fallback; --config overrides discovery - run and
  // capture share this path (capture measures the population run will classify)
  let resolvedConfig: ResolvedConfig;
  let configPath: string | null;
  try {
    ({ resolvedConfig, configPath } = await loadCliConfig(cliArgs));
  } catch (thrown) {
    // Config-load errors are config-origin: no flag label applies.
    return exitForThrown(thrown);
  }

  // Input resolution precedence: command noun > stdin > config.input > error. A positional
  // path's kind is inferred by shape (exists-as-dir -> dir, else file — inference is exactly
  // that); piped stdin is DECLARED by a noun (jint run str - for source, jint run paths - for a path
  // list), never guessed. Undeclared stdin is never read, so config.input flows whatever stdin
  // is. A TTY is never read; a TTY with the
  // payload '-' dies here, not blocking on the terminal, and a TTY with no noun and no config
  // input dies in lint()'s empty-input backstop.
  let selection: Awaited<ReturnType<typeof resolveCliInput>>;
  try {
    selection = await resolveCliInput(verb.rest);
  } catch (thrown) {
    return exitForThrown(thrown);
  }
  if (selection.outcome === "usage") return 2;
  const { stdinStr, lintInput, elementScope, pathsContent } = selection;

  // Run knobs: flags override the config; all funnel into the SDK options (thin-client rule).
  const concurrency = numericFlag(cliArgs.concurrency, "--concurrency");
  const timeout = numericFlag(cliArgs.timeout, "--timeout");
  const knobProblem = checkRunKnobs({ concurrency, timeout });
  if (knobProblem !== null) {
    usageError(knobProblem + " - see jint --help");
    return 2;
  }

  // The effective rule set — config rules filtered by --disable/--rule — shared by the stderr
  // pre-print and --dry-run, so the block always names exactly what the run will classify.
  const effective = selectRules(resolvedConfig.rules, [], cliArgs.disable, cliArgs.rule).json;

  // Pre-flight: setup failures surface BEFORE the rubric pre-print - the block names what WILL
  // run, so a run that cannot start prints its error alone (ordering, not volume: the block
  // itself stays deliberate for runs that proceed).
  try {
    validateRuleSelection(
      resolvedConfig.rules,
      resolvedConfig.customRules ?? [],
      cliArgs.disable,
      cliArgs.rule,
    );
  } catch (thrown) {
    // The pre-flight knows which flag filled the names: the emitter labels the origin.
    return exitForThrown(thrown, ruleOriginLabel(cliArgs, resolvedConfig));
  }

  // --dry-run: resolve + validate everything (config errors, knobs), print the effective rule
  // set, and stop BEFORE any input walk or classifier call. No requests dir, no record notice —
  // the stdout block is the whole payload (the flag's product, pipe-able). With --json the
  // payload composes: one JSON document on stdout, the banner on stderr (same byte-clean
  // contract as a run's --json).
  if (cliArgs["dry-run"] === true) {
    if (cliArgs.json === true) {
      printRulesJson(effective, resolvedConfig.customRules?.length ?? 0);
    } else {
      printRulesStdout(effective, resolvedConfig.customRules?.length ?? 0);
    }
    return 0;
  }

  try {
    // The rubric lands in the consumer's context BEFORE the findings it interprets:
    // full prose, stderr, never on stdout. Findings carry rule names; this block is the only
    // place their meaning lives in-band (context timing, not artifact embedding — output can
    // be sub-sampled, context cannot). A path input that does not exist fails HERE, so the
    // rubric never prints for a run that cannot start.
    if (typeof lintInput?.input === "string" && !existsSync(lintInput.input)) {
      throw new SetupError("ENTRYPOINT_NOT_FOUND", `input not found: ${lintInput.input}`);
    }
    // Auth pre-flight (the same check lint() makes): with rules to classify and no key
    // anywhere, the run aborts anyway - surface it before the rubric block so the one
    // actionable line is never buried under it.
    if (effective.length + (resolvedConfig.customRules?.length ?? 0) > 0) {
      assertEndpointKey(resolvedConfig);
    }
    printRules(effective, resolvedConfig.customRules?.length ?? 0);
    // The lint input, statement-resolved (no conditional spreads): with no flags and no stdin pass
    // NO input key so lint()'s ?? config.input fallback applies ("" would shadow the config —
    // lint() keeps the empty-input backstop).
    const lintInputOptions: Record<string, unknown> = {};
    if (stdinStr !== undefined) {
      lintInputOptions.str = stdinStr;
      lintInputOptions.language = cliArgs.language;
    } else if (lintInput !== undefined) {
      Object.assign(lintInputOptions, lintInput);
    }
    // Config-scope basis (scopeBase): dir inputs walk with paths prefixed by their location
    // relative to the CONFIG's directory, so the config's scope patterns apply no matter
    // where the walk starts (git parity). Walks outside the config dir keep no prefix.
    if (lintInput?.input !== undefined && typeof lintInput.input === "string") {
      const base = configScopeBase(configPath, lintInput.input);
      if (base !== undefined) lintInputOptions.scopeBase = base;
    }
    // The element-scoped echo: WHICH element each selector captured, printed BEFORE any
    // measurement - a line that drifted after edits selects a different unit silently, and
    // nothing in a bare score contradicts the wrong assumption. The SDK resolves the fact
    // (selectedElements); the CLI owns the rendering. --json keeps stdout a single document:
    // the same fact rides the report as `selected`.
    const selected: SelectedElement[] =
      elementScope !== undefined ? await selectedElements(elementScope) : [];
    if (elementScope !== undefined && cliArgs.json !== true) printSelection(selected);
    const lintReport = await collectReport(
      lint({
        config: resolvedConfig,
        ...lintInputOptions,
        exclude: cliArgs.exclude,
        cache: cliArgs["no-cache"] === true ? false : undefined,
        disable: cliArgs.disable,
        only: cliArgs.rule,
        log: providerLog,
        concurrency,
        timeout,
        paths: pathsContent !== undefined ? { content: pathsContent } : undefined,
        element:
          elementScope !== undefined
            ? {
                path: elementScope.path,
                anchor: elementScope.anchor,
                ranges: elementScope.ranges,
              }
            : undefined,
      }),
    );
    // One canonical artifact: renderJson's bytes ARE report.json AND the --json stdout. The
    // default stdout is the raw-line projection of the same report (findings only); totals and
    // run errors stay on stderr. Persistence is NEVER gated on --json — the flag is a stdout
    // format choice (output-architecture design).
    if (selected.length > 0) lintReport.selected = selected;
    const reportJson = renderJson(lintReport);
    const rendered =
      cliArgs.json === true ? { stdout: reportJson, stderr: "" } : renderLines(lintReport);
    recordRunReport(reportJson);
    recordRunManifest({
      configPath,
      cwd: process.cwd(),
      argv: process.argv,
      ts: new Date().toISOString(),
      handles: Object.fromEntries(
        resolvedConfig.rules.flatMap((r) =>
          r.handleData ? [[r.name, r.handleData] as const] : [],
        ),
      ),
    });
    process.stdout.write(rendered.stdout);
    if (rendered.stderr !== "") emitLines(rendered.stderr);
    // The element-scoped content echo: resolution map + edge sections, stderr only (stdout stays
    // pure finding data). Failure of the run itself already reported — never double-report.
    if (elementScope !== undefined) {
      const echo = await selectionEcho(elementScope, lintReport.findings);
      for (const header of echo.headers) emit({ message: header });
      if (echo.body !== "") process.stderr.write(echo.body);
    }
    const exit = computeExit(lintReport);
    const notice = recordNotice();
    if (notice !== "") emit({ message: notice });
    return exit;
  } catch (thrown) {
    return exitForThrown(thrown, ruleOriginLabel(cliArgs, resolvedConfig));
  }
}

/**
 * The serve verb's tail: serve the run UI in-process, print the url, hold until SIGINT (close
 * server, exit 0 — Ctrl+C is just the viewer leaving). The app opens newest-run-first, so no route
 * string couples the CLI to the UI router. A broken UI setup maps to 2 (usage/config: the
 * invocation itself is broken). JINT_UI_NO_HOLD=1 gates the hold so tests and scripted invocations
 * exercise the verb without pinning a process.
 */
async function serveUiHold(onUiFailure: (thrown: unknown) => number): Promise<number> {
  let ui;
  try {
    ui = await startUi();
  } catch (thrown) {
    return onUiFailure(thrown);
  }
  emit({ message: `ui -> ${ui.url}` });
  if (process.env.JINT_UI_NO_HOLD === "1") {
    ui.close();
    return 0;
  }
  // The hold OWNS SIGINT — ownership-transferring: the import.meta.main handler exits 130
  // promptly DURING a run, but once the UI is up Ctrl+C means "close the server, leave
  // cleanly" with the run's exit code, so the earlier handler must not fire.
  process.removeAllListeners("SIGINT");
  await new Promise<void>((resolveHold) => {
    process.once("SIGINT", () => {
      ui.close();
      resolveHold();
    });
  });
  return 0;
}

/**
 * The serve verb's UI-failure mapping: no run happened, so a broken UI setup IS the invocation
 * failing (usage/config), not a run error.
 */
const viewerUiFailure = (thrown: unknown): number => {
  usageError(thrown instanceof Error ? thrown.message : String(thrown));
  return 2;
};

/**
 * The store has at least one run: a directory under runsBase() (run dirs are timestamp-named;
 * namespace dirs wrap case runs one level down). A missing base is the same answer - nothing to
 * serve.
 */
function storeHasRuns(): boolean {
  try {
    return readdirSync(runsBase(), { withFileTypes: true }).some((entry) => entry.isDirectory());
  } catch {
    return false;
  }
}

/**
 * Serve: the run store's UI, standalone - no measurement, no config, no arguments. The app opens
 * the store's NEWEST run first (the fix loop: measure with `jint run`, then look with `jint
 * serve`). Any positional is a usage error; an empty store fails loud, naming the store.
 */
async function serveVerb(rest: readonly string[]): Promise<number> {
  if (rest.length > 0) {
    usageError("serve takes no arguments  - it opens the store's newest run: jint serve");
    return 2;
  }
  if (!storeHasRuns()) {
    usageError(
      `no runs in the store (${runsBase()}) - jint run records one, then jint serve opens it`,
    );
    return 2;
  }
  return serveUiHold(viewerUiFailure);
}

/**
 * Capture [<target>] [--queries <file.scm>] [--grammar <dir>] [--rule <name>]: a thin print of the
 * SDK's capture scope - input resolution, grammar routing, extraction; no rules run, no classifier,
 * no stdin (a dash target is run's str noun, not capture's). The CONFIG loads exactly like run's
 * (--config > discovered jint.config.* > the structure-only config), so capture measures the same
 * population a run will classify: no target walks the config's input; a target walks it under the
 * config's still-applicable scoping (include/exclude/secretDenylist - an explicit single FILE
 * bypasses excludes, as in run); a config that cannot load fails with run's exact error. --rule
 * previews ONE rule's population: the elements its target and scope globs would measure carry the
 * marker (matches: true in --json, a leading * column in lines); nothing is classified. --exclude
 * unions on top of the config's excludes - run's mechanism, reused. One target, exactly: a
 * directory covers its whole tree. Lines on stdout, one per element; --json prints the element
 * array under the flag-product convention (one JSON document, errors stay on stderr). Setup
 * failures map through exitForThrown (2): the invocation is broken, not the extraction.
 */
async function captureVerb(cliArgs: CliArgs, rest: readonly string[]): Promise<number> {
  if (rest.length > 1) {
    usageError("jint capture takes one target path  - a directory covers its whole tree");
    return 2;
  }
  if (rest[0] === "-") {
    usageError("capture takes files and dirs  - piped stdin is run's str noun: jint run str -");
    return 2;
  }
  if ((cliArgs.rule?.length ?? 0) > 1) {
    usageError(
      "jint capture previews one rule at a time  - pass one --rule name (repeat the command for another rule)",
    );
    return 2;
  }
  let resolvedConfig: ResolvedConfig;
  let configPath: string | null;
  try {
    ({ resolvedConfig, configPath } = await loadCliConfig(cliArgs, cliArgs.rule !== undefined));
  } catch (thrown) {
    // the same scope, the same message: a config run cannot load, capture cannot either
    return exitForThrown(thrown);
  }
  if (rest.length === 0 && resolvedConfig.input === "") {
    usageError(
      "jint capture expects a target path  - use: jint capture <path> [--queries <file.scm>] [--grammar <dir>], or set input in the config",
    );
    return 2;
  }
  try {
    // a dir's unclaimable files: one onSkip event each, folded here into ONE stderr note (the
    // extension set - lint's sweep-coverage words); stdout stays the one payload document
    const skips: { file: string; extension: string }[] = [];
    const notes: string[] = [];
    const walk = captureFor(resolvedConfig, {
      exclude: cliArgs.exclude,
      rule: cliArgs.rule?.[0],
      scopeBase: rest[0] !== undefined ? configScopeBase(configPath, rest[0]) : undefined,
      onNote: (note) => notes.push(note),
    });
    const elements = await walk(
      rest[0],
      cliArgs.queries,
      cliArgs.grammar,
      (skip) => skips.push(skip),
      (summary) => {
        // the input accounting's human mirror, stderr-only (stdout stays the element payload):
        // one line when anything was dropped, a second naming the scope when NOTHING was measured
        for (const line of renderInputSummary(
          summary,
          walkScopes(resolvedConfig.include, resolvedConfig.rules),
        )) {
          emit({ message: line, kind: "note" });
        }
      },
    );
    const skipped = [...new Set(skips.map((s) => s.extension))].sort();
    if (skipped.length > 0) {
      emit({ message: "not parsed (no grammar): " + skipped.join(", "), kind: "note" });
    }
    for (const note of notes) emit({ message: note, kind: "note" });
    process.stdout.write(cliArgs.json === true ? captureJson(elements) : captureLines(elements));
    return 0;
  } catch (thrown) {
    return exitForThrown(thrown, ruleOriginLabel(cliArgs, resolvedConfig));
  }
}

/** ParseArgs carries number flags as strings; coerce, naming the flag on a bad value. */
function numericFlag(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (value.trim() === "") {
    usageError(`${flag} requires a number, got an empty value - see jint --help`);
    return undefined;
  }
  const n = Number(value);
  if (Number.isNaN(n)) {
    usageError(`${flag} must be a number, got '${value}' - see jint --help`);
    return undefined;
  }
  return n;
}

/** A parsed element selector riding a file noun: an anchor line, or a comma list of ranges. */
export interface FileSelector {
  readonly path: string;
  /** @L<n>: the unique element containing the line. */
  readonly anchor?: number;
  /** @L<s>-<e> items: elements FULLY ENCLOSED in each inclusive span. */
  readonly ranges?: readonly { readonly start: number; readonly end: number }[];
  /** Uuid-shaped #id stem: rejected with guidance (ids are run-scoped, never a query surface). */
  readonly pastedId?: boolean;
  /** @L present but unparseable (end < start, non-digits, trailing characters). */
  readonly badRange?: string;
}

const UUID_SOURCE = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/**
 * Parse the element selector off a file noun: `path` or `path@L<n>`. The suffix is only peeled when
 * it matches its shape (digits after @L), so real paths containing @ stay paths. A uuid- shaped
 * `#id` stem — a finding string pasted from older output — is NOT a selector: element ids are
 * run-scoped internals and cannot select across runs; the caller reports guidance (pastedId). No
 * selector: the token IS the path.
 */
export function parseFileSelector(token: string): FileSelector {
  if (token.match(new RegExp("#" + UUID_SOURCE + "(@L([0-9]+))?$", "i")))
    return { path: token, pastedId: true };
  const atLine = token.indexOf("@L");
  if (atLine !== -1) {
    const stem = token.slice(0, atLine);
    const items = token
      .slice(atLine + 1)
      .split(",")
      .map((item) => item.trim().replace(/^@/, ""));
    const ranges: { start: number; end: number }[] = [];
    let anchor: number | undefined;
    for (const item of items) {
      const single = item.match(/^L([0-9]+)$/);
      if (single) {
        const n = Number(single[1]);
        // an anchor list is nonsense (containment is unique); one anchor OR ranges
        if (items.length === 1) anchor = n;
        else ranges.push({ start: n, end: n });
        continue;
      }
      const spread = item.match(/^L([0-9]+)-L?([0-9]+)$/);
      if (spread) {
        const start = Number(spread[1]);
        const end = Number(spread[2]);
        if (start <= end) {
          ranges.push({ start, end });
          continue;
        }
      }
      return { path: stem, badRange: item };
    }
    if (anchor !== undefined) return { path: stem, anchor };
    if (ranges.length > 0) return { path: stem, ranges };
    return { path: stem, badRange: token.slice(atLine + 2) };
  }
  return { path: token };
}

/** ParseCliArgs result: validated modifier flags plus raw positionals, or a usage message. */
type CliArgsParse =
  | { outcome: "parsed"; cliArgs: CliArgs; positionals: string[] }
  | { outcome: "usage-error"; usageMessage: string };

/**
 * Modifier flags jint still knows — DERIVED from FLAGS (names and single-char aliases). Anything
 * dash-leading outside this set is a PATH (dash-path), not a flag: `--` ends flag parsing, and the
 * runtime strips it from argv before we see it. An unknown dash-token reaches dispatch as a
 * positional and dies as ONE consistent usage error naming the token — no per-flag special cases.
 */
export const KNOWN_FLAGS: ReadonlySet<string> = new Set([
  ...Object.keys(FLAGS),
  ...Object.values(FLAGS).flatMap((flag) => ("aliases" in flag ? [...flag.aliases] : [])),
]);

function isFlagToken(token: string): boolean {
  if (!token.startsWith("-") || token === "-") return false;
  return KNOWN_FLAGS.has(token.split("=")[0]!);
}

/** Flags that consume the next argv token as their value: every non-boolean entry in FLAGS. */
export const VALUED_FLAGS: ReadonlySet<string> = new Set(
  Object.entries(FLAGS)
    .filter(([, flag]) => flag.type !== "boolean")
    .map(([name]) => name),
);

/**
 * Split raw argv into modifier-flag tokens (for parseArgs) and positionals (for dispatch). `--`
 * ends flag parsing: everything after it is positional, verbatim (dash-paths). Flags may appear
 * before or after positionals (jint run --json src/ == jint run src/ --json). A noun's next token
 * rides with it as the payload positional, so dispatch — not this scan — enforces the payload rule
 * ('-', nothing else); flag scanning resumes after the payload.
 */
export function splitArgv(argv: string[]): { flagArgs: string[]; positionals: string[] } {
  const flagArgs: string[] = [];
  const positionals: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const token = argv[i]!;
    if (token === "--") {
      // everything after -- is positional, verbatim
      for (i = i + 1; i < argv.length; i++) positionals.push(argv[i]!);
      return { flagArgs, positionals };
    }
    if (!isFlagToken(token)) break;
    flagArgs.push(token);
    i++;
    if (VALUED_FLAGS.has(token) && i < argv.length) flagArgs.push(argv[i++]!);
  }
  if (i < argv.length) {
    const first = argv[i]!;
    positionals.push(first);
    i++;
    if (Object.hasOwn(NOUNS, first) && i < argv.length) {
      // the noun's payload rides as the next positional; dispatch enforces the '-' rule on it
      positionals.push(argv[i]!);
      i++;
    }
  }
  while (i < argv.length) {
    const token = argv[i]!;
    if (token === "--") {
      for (i = i + 1; i < argv.length; i++) positionals.push(argv[i]!);
      return { flagArgs, positionals };
    }
    if (isFlagToken(token)) {
      flagArgs.push(token);
      i++;
      if (VALUED_FLAGS.has(token) && i < argv.length) flagArgs.push(argv[i++]!);
    } else {
      positionals.push(token);
      i++;
    }
  }
  return { flagArgs, positionals };
}

function parseCliArgs(cliArgv: string[]): CliArgsParse {
  const { flagArgs, positionals } = splitArgv(cliArgv);
  let values: Record<string, unknown>;
  try {
    values = parseArgs({ args: flagArgs, options: PARSE_ARGS_OPTIONS, strict: true }).values;
  } catch (thrown) {
    const parseFailureDetail = thrown instanceof Error ? thrown.message : String(thrown);
    return { outcome: "usage-error", usageMessage: `${parseFailureDetail} - see jint --help` };
  }
  if (!TypeBoxValue.Check(CLI_ARGS_SCHEMA, values)) {
    const validationMessages = [...TypeBoxValue.Errors(CLI_ARGS_SCHEMA, values)]
      .map((validationIssue) => `${validationIssue.path} ${validationIssue.message}`)
      .join("; ");
    return {
      outcome: "usage-error",
      usageMessage: `invalid arguments: ${validationMessages} - see jint --help`,
    };
  }
  return { outcome: "parsed", cliArgs: values as unknown as CliArgs, positionals };
}

/**
 * Exit invariant: findings only — error-severity findings -> 1; zero measurements -> 4. Per-unit
 * ClassifyErrors are signalled (streamed, printed on stderr) but never fail the run: a unit the
 * linter could not classify is reported, not treated as a lint violation.
 */
export function computeExit(lintReport: LintReport): number {
  if (lintReport.findings.some((finding) => finding.severity === "error")) return 1;
  // A failed unit means the judgment never existed — the run classified PARTIALLY at best. CI must
  // never pass a half-classified input, so any streamed ClassifyError fails the run (exit 4).
  if (lintReport.errors.length > 0 || lintReport.measurements.length === 0) return 4;
  return 0;
}

/** The list size ceiling for one declared stdin read (jint run paths -). */
const MAX_LIST_BYTES = 16 * 1024 * 1024;

/**
 * The stdin read behind `jint run paths -` — the CLI's half of the noun: bytes are capped, must
 * decode as UTF-8, and must contain no NUL (binary, or git -z output, is not a line-separated
 * list). LIST_UNREADABLE fails loud here instead of degrading into mystery "not found in the walk"
 * notes: a list is never sniffed, so garbage cannot pass as paths.
 */
async function readStdinList(): Promise<string> {
  const bytes = new Uint8Array(await Bun.stdin.arrayBuffer());
  if (bytes.byteLength > MAX_LIST_BYTES) {
    throw new SetupError(
      "ENTRYPOINT_UNREADABLE",
      `path list exceeds the ${MAX_LIST_BYTES} byte cap: ${bytes.byteLength} bytes`,
    );
  }
  if (bytes.includes(0)) {
    throw new SetupError(
      "LIST_UNREADABLE",
      "path list entries must be line-separated paths; NUL-separated input (git -z) is not a list",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new SetupError(
      "LIST_UNREADABLE",
      `path list is not UTF-8 text (${bytes.byteLength} bytes) - binary input is not a path list (a list is one path per line)`,
      { cause },
    );
  }
}

/**
 * Boundary mapping, exactly once and TYPE-driven: SetupError -> 2, InternalError -> 3, an escaped
 * ClassifyError -> 4 (the run happened but produced nothing usable). An unknown-shaped throw wraps
 * into InternalError - the bug bucket. Detail renders through the emitter (message leads, code
 * trails); the structured debug log keeps the raw message. Exported for the emitter-shape tests.
 */
export function exitForThrown(thrown: unknown, origin?: string): number {
  const error =
    thrown instanceof SetupError ||
    thrown instanceof InternalError ||
    thrown instanceof ClassifyError
      ? thrown
      : new InternalError(thrown instanceof Error ? thrown.message : String(thrown), {
          cause: thrown,
        });
  log("error", error.message, { errorCode: error.code });
  emit({ message: thrownLine(error, origin), code: error.code, kind: "error" });
  if (error instanceof SetupError) return 2;
  if (error instanceof InternalError) return 3;
  return 4;
}

if (import.meta.main) {
  // EPIPE (from `| head`) exits cleanly, no stack trace; SIGINT exits non-zero, promptly.
  process.stdout.on("error", (writeError: NodeJS.ErrnoException) => {
    if (writeError.code === "EPIPE") process.exit(0);
    throw writeError;
  });
  process.on("SIGINT", () => process.exit(130));
  process.exitCode = await runCli(process.argv.slice(2));
}
