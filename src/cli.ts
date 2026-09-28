#!/usr/bin/env bun
/**
 * Jint CLI — the terminal as SDK client (design §4).
 *
 * Exit codes (computed once, here): 0 clean 1 error-severity findings 2 usage/config error (bad
 * flags, CONFIG_INVALID, ENTRYPOINT_*) 3 internal error 4 ran but classified nothing or any unit
 * failed to classify — CI never passes an unclassified or half-classified run)
 *
 * Stream discipline (clig): stdout carries findings — the report and its summary; stderr carries
 * the run's own errors and diagnostics — setup failures, failed units — plus structured logs
 * (default silent; --debug). Either stream stays usable with the other discarded.
 */

import { existsSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import { Type as TypeBoxType, type Static as TypeBoxStatic } from "@sinclair/typebox";
import { Value as TypeBoxValue } from "@sinclair/typebox/value";
import packageJson from "../package.json";
import { loadConfig, defaultConfig, DEFAULT_CONFIG_PATH } from "./config/load.ts";
import { knownLanguages } from "./core/input/walk.ts";
import { requestTapSummary } from "./core/jev/debug.ts";
import { lint, collectReport, type LintReport } from "./core/lint.ts";
import { renderJson } from "./core/output/json.ts";
import { renderStylish } from "./core/output/stylish.ts";
import { ClassifyError, SetupError, type InputKind } from "./core/types.ts";
import { log, setLogLevel } from "./logger.ts";
import type { ResolvedConfig } from "./config/load.ts";

const COLOR_MODE_SCHEMA = TypeBoxType.Union([
  TypeBoxType.Literal("auto"),
  TypeBoxType.Literal("always"),
  TypeBoxType.Literal("never"),
]);

/** CLI args boundary — validated with TypeBox like every external input. */
const CLI_ARGS_SCHEMA = TypeBoxType.Object({
  language: TypeBoxType.Optional(TypeBoxType.String()),
  config: TypeBoxType.Optional(TypeBoxType.String()),
  json: TypeBoxType.Optional(TypeBoxType.Boolean()),
  debug: TypeBoxType.Optional(TypeBoxType.Boolean()),
  color: TypeBoxType.Optional(COLOR_MODE_SCHEMA),
  exclude: TypeBoxType.Optional(TypeBoxType.Array(TypeBoxType.String())),
  disable: TypeBoxType.Optional(TypeBoxType.Array(TypeBoxType.String())),
  rule: TypeBoxType.Optional(TypeBoxType.Array(TypeBoxType.String())),
  help: TypeBoxType.Optional(TypeBoxType.Boolean()),
  version: TypeBoxType.Optional(TypeBoxType.Boolean()),
});

type CliArgs = TypeBoxStatic<typeof CLI_ARGS_SCHEMA>;

const HELP = `jint — jev lint: classifies code with AI-classifier judgments; rules in, findings out.

Usage:
  jint src/                       classify a directory tree
  jint a.ts b.ts                  classify files
  git diff HEAD~1 | jint diff -   piped stdin, declared a diff
  jint diff fix.patch             a patch file, declared a diff
  cat snippet.ts | jint str -     piped stdin, one str unit
  jint                            no positional: input comes from jint.config.json

The resource is the noun; the verb (classify) is implicit. str and diff are nouns only as the
FIRST positional; the next positional is their payload, taken verbatim — no flag parsing:
jint str "--json" classifies "--json" as source. Nouns never resolve to paths — a file named
diff is reached as jint ./diff, and a str payload that names an existing path is rejected
(inline source or '-' only; classify the file as jint <path>). A path's kind is inferred by shape only (exists-as-dir -> dir,
else file); content is never sniffed. Piped stdin is declared by a noun, never guessed. --
ends flag parsing for dash-paths: jint -- --weird.ts

Options:
  --language <id>     tree-sitter grammar for piped-stdin/extensionless sources; valid ids:
                      typescript, python, go. Without a resolvable language, inventory-scoped
                      rules fail WALK_FAILED in-band and unit-scoped rules still classify
  --config <path>     config file, plain JSON (default: jint.config.json; autocomplete via
                      the checked-in jint.schema.json "$schema" key)
  --exclude <glob>    input exclusion, on top of config (repeatable)
  --disable <name>    rule removal by name, on top of config (repeatable)
  --rule <name>      run ONLY these rules (repeatable); overrides --disable for the named set
  --json              machine report (jint-report/v1) instead of the human table
  --color <mode>      auto | always | never (default: auto — color only on a TTY)
  --debug             structured debug logs on stderr
  -h, --help          this help
  --version           print the version

Exit codes: 0 clean, 1 error findings, 2 usage/config, 3 internal, 4 zero measurements.

`;

/**
 * End-of-run stderr notice for the request tap: where the captures went and how many. Nothing when
 * the tap is inactive; an active tap always reports, even zero captures (the run may have failed
 * before any classifier call).
 */
export function requestTapNotice(): string {
  const tap = requestTapSummary();
  if (tap === null) return "";
  const override = tap.override ? " (override: JEV_DEBUG_REQUEST_LOCATION)" : "";
  return `jint: request captures -> ${tap.dir} (${tap.count} calls)${override}\n`;
}

export async function runCli(cliArgv: string[]): Promise<number> {
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
  // An unknown grammar is a usage error before any input is touched: the run would stream
  // WALK_FAILED for the unit and still exit clean. Name the language, name the remedy.
  if (cliArgs.language !== undefined && !knownLanguages().includes(cliArgs.language)) {
    usageError(`unknown language '${cliArgs.language}' - see --help for valid grammar ids`);
    return 2;
  }
  if (cliArgs.debug === true) setLogLevel("debug");

  let resolvedConfig: ResolvedConfig;
  try {
    resolvedConfig =
      cliArgs.config !== undefined
        ? await loadConfig(cliArgs.config)
        : existsSync(DEFAULT_CONFIG_PATH)
          ? await loadConfig()
          : defaultConfig();
  } catch (thrown) {
    return exitForThrown(thrown);
  }

  // Input resolution precedence: command noun > stdin > config.input > error. A positional
  // path's kind is inferred by shape (exists-as-dir -> dir, else file — inference is exactly
  // that); piped stdin is DECLARED by a noun (jint diff - / jint str -), never guessed. EMPTY
  // piped stdin falls through so config.input can flow (a closed or /dev/null stdin is the
  // config-only invocation shape). A TTY is never read; a TTY with payload "-" dies here, not
  // blocking on the terminal, and a TTY with no noun and no config input dies in lint()'s
  // empty-input backstop.
  let stdinStr: { content: string } | undefined;
  let stdinDiff: { text: string } | undefined;
  // the run's input is a diff (piped or patch file): exit-4 remedy wording
  let diffRun = false;
  let lintInput: { input: string | string[]; inputType?: InputKind } | undefined;
  const positionals = parsedCliArgs.positionals;
  const firstPositional = positionals[0];
  if (firstPositional === "-") {
    usageError(
      "bare '-' does not declare a kind — use: jint diff - (piped diff) or jint str - (piped source)",
    );
    return 2;
  }
  if (firstPositional === "diff" || firstPositional === "str") {
    // Nouns never resolve to filesystem paths (a repo file named 'diff' is reached as ./diff);
    // the payload is the raw next positional, consumed without flag interpretation.
    const payload = positionals[1];
    if (payload === undefined) {
      usageError(
        `jint ${firstPositional} expects a payload — use: jint ${firstPositional} - (piped stdin) or jint ${firstPositional} <${firstPositional === "diff" ? "fix.patch" : '"code"'}>`,
      );
      return 2;
    }
    if (payload === "-") {
      if (process.stdin.isTTY) {
        usageError(`jint ${firstPositional} -: no piped stdin to classify (stdin is a terminal)`);
        return 2;
      }
      const content = await Bun.stdin.text();
      if (firstPositional === "str") stdinStr = { content };
      else {
        stdinDiff = { text: content };
        diffRun = true;
      }
    } else if (firstPositional === "diff") {
      // a patch path; readDiffSource resolves it
      lintInput = { input: payload, inputType: "diff" };
      diffRun = true;
    } else if (existsSync(payload)) {
      // A payload that names a real path is almost certainly a mistyped file classify: honoring it
      // as inline text would classify the PATH STRING as source (degenerate state) under the
      // grammarless str:stdin identity. Nouns never resolve to paths, so reject with the remedy.
      usageError(
        `'${payload}' is a path — jint str classifies inline source or '-' (piped stdin); to classify the file use: jint ${payload}`,
      );
      return 2;
    } else {
      // inline source text, identity "input"
      stdinStr = { content: payload };
    }
  } else if (positionals.length > 0) {
    // Paths. Files may be many; a directory is exactly one path (the walk owns its tree).
    if (positionals.length > 1) {
      try {
        if (statSync(positionals[0]!).isDirectory()) {
          usageError(`a directory is one path — use: jint ${positionals[0]}`);
          return 2;
        }
      } catch {
        // first positional not stat-able: file list — fileUnit reports ENTRYPOINT_NOT_FOUND
      }
    }
    // A dash-leading positional that does not exist is most likely a mistyped flag (or a flag
    // whose `--` separator the bun runtime consumed): say so instead of a bare not-found.
    for (const positional of positionals) {
      if (positional.startsWith("-") && !existsSync(positional)) {
        usageError(`unknown option or missing path '${positional}' — see jint --help`);
        return 2;
      }
    }
    // shape inference: exists-as-dir -> dir, else file
    lintInput =
      positionals.length === 1
        ? { input: positionals[0]! }
        : { input: positionals, inputType: "file" };
  } else if (!process.stdin.isTTY) {
    const content = await Bun.stdin.text();
    if (content !== "") {
      usageError(
        "piped stdin needs a noun declaring its kind — use: jint diff - (unified diff) or jint str - (one source snippet)",
      );
      return 2;
    }
  }

  try {
    const lintReport = await collectReport(
      lint({
        config: resolvedConfig,
        // No flags and no stdin: pass NO input key so lint()'s ?? config.input fallback
        // applies ("" would shadow the config — lint() keeps the empty-input backstop).
        ...(stdinStr !== undefined
          ? { str: stdinStr, language: cliArgs.language }
          : stdinDiff !== undefined
            ? { diffText: stdinDiff }
            : (lintInput ?? {})),
        exclude: cliArgs.exclude,
        disable: cliArgs.disable,
        only: cliArgs.rule,
      }),
    );
    // JSON: the document is data (errors ride in it) — stdout only, stderr untouched.
    // Stylish: findings on stdout, run errors/diagnostics on stderr.
    const rendered =
      cliArgs.json === true
        ? { stdout: renderJson(lintReport), stderr: "" }
        : renderStylish(lintReport, cliArgs.color ?? "auto");
    process.stdout.write(rendered.stdout);
    process.stderr.write(rendered.stderr);
    const exit = computeExit(lintReport);
    // Zero measurements is never silent for humans: an empty diff looks identical to a crash
    // with zero bytes of explanation. The empty report itself is the machine-facing truth.
    if (exit === 4 && cliArgs.json !== true && diffRun) {
      process.stderr.write("jint: no measurements - empty diff\n");
    }
    process.stderr.write(requestTapNotice());
    return exit;
  } catch (thrown) {
    return exitForThrown(thrown);
  }
}

/** ParseCliArgs result: validated modifier flags plus raw positionals, or a usage message. */
type CliArgsParse =
  | { outcome: "parsed"; cliArgs: CliArgs; positionals: string[] }
  | { outcome: "usage-error"; usageMessage: string };

/** Flags removed by the noun grammar; each error points at the new form. */
const REMOVED_FLAGS: Readonly<Record<string, string>> = {
  "--file": "use: jint <path>... (e.g. jint src/a.ts)",
  "--dir": "use: jint <dir> (e.g. jint src/)",
  "--kind": "use: jint diff - (piped diff) or jint str - (piped source)",
  "--diff": "use: jint diff -",
};

/**
 * Modifier flags jint still knows. Anything dash-leading outside this set is a PATH (dash-path),
 * not a flag — `--` ends flags, and the bun runtime strips it from argv before we see it.
 */
const KNOWN_FLAGS: ReadonlySet<string> = new Set([
  // removed flags are parsed only so their error can point at the new form
  ...Object.keys(REMOVED_FLAGS),
  "--language",
  "--config",
  "--color",
  "--exclude",
  "--disable",
  "--rule",
  "--json",
  "--debug",
  "--help",
  "-h",
  "--version",
]);

function isFlagToken(token: string): boolean {
  if (!token.startsWith("-") || token === "-") return false;
  return KNOWN_FLAGS.has(token.split("=")[0]!);
}

const NOUNS: ReadonlySet<string> = new Set(["diff", "str"]);

/** Modifier flags that take a value token; their value must ride with them into parseArgs. */
const VALUED_FLAGS: ReadonlySet<string> = new Set([
  "--language",
  "--config",
  "--color",
  "--exclude",
  "--disable",
  "--rule",
]);

/**
 * Split raw argv into modifier-flag tokens (for parseArgs) and positionals (for noun dispatch).
 * `--` ends flag parsing: everything after it is positional (dash-paths). The noun token's next
 * positional is the payload, taken verbatim — no flag interpretation (jint str "--json"). Flags may
 * appear before or after positionals (jint --json src/ == jint src/ --json); after the noun payload
 * is consumed, flag scanning resumes for the rest.
 */
function splitArgv(argv: string[]): { flagArgs: string[]; positionals: string[] } {
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
    if (NOUNS.has(first) && i < argv.length) {
      // the payload, verbatim — never flag-parsed
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
    values = parseArgs({
      args: flagArgs,
      options: {
        language: { type: "string" },
        config: { type: "string" },
        json: { type: "boolean" },
        debug: { type: "boolean" },
        color: { type: "string" },
        exclude: { type: "string", multiple: true },
        disable: { type: "string", multiple: true },
        rule: { type: "string", multiple: true },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
      },
      strict: true,
    }).values;
  } catch (thrown) {
    const parseFailureDetail = thrown instanceof Error ? thrown.message : String(thrown);
    for (const [removed, hint] of Object.entries(REMOVED_FLAGS)) {
      if (parseFailureDetail.includes(removed)) {
        return {
          outcome: "usage-error",
          usageMessage: `${removed} was removed — ${hint} — see jint --help`,
        };
      }
    }
    return { outcome: "usage-error", usageMessage: `${parseFailureDetail} — see jint --help` };
  }
  if (!TypeBoxValue.Check(CLI_ARGS_SCHEMA, values)) {
    const validationMessages = [...TypeBoxValue.Errors(CLI_ARGS_SCHEMA, values)]
      .map((validationIssue) => `${validationIssue.path} ${validationIssue.message}`)
      .join("; ");
    return {
      outcome: "usage-error",
      usageMessage: `invalid arguments: ${validationMessages} — see jint --help`,
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

/** Boundary mapping, exactly once: setup -> 2, internal -> 3, an escaped classify error -> 4. */
function exitForThrown(thrown: unknown): number {
  const error =
    thrown instanceof SetupError || thrown instanceof ClassifyError
      ? thrown
      : new SetupError("INTERNAL", thrown instanceof Error ? thrown.message : String(thrown), {
          cause: thrown,
        });
  log("error", error.message, { errorCode: error.code });
  process.stderr.write(`jint: ${error.code}: ${error.message}\n`);
  if (
    error.code === "CONFIG_INVALID" ||
    error.code === "ENTRYPOINT_NOT_FOUND" ||
    error.code === "ENTRYPOINT_UNREADABLE" ||
    error.code === "NOT_SOURCE" ||
    error.code === "RULE_INVALID"
  )
    return 2;
  // A ClassifyError that escaped the stream: the run happened but produced nothing
  if (error instanceof ClassifyError) return 4;
  if (error.code === "INTERNAL") return 3;
  return 4;
}

function usageError(usageMessage: string): void {
  process.stderr.write(`jint: ${usageMessage}\n`);
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
