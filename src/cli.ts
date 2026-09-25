#!/usr/bin/env bun
/**
 * Jint CLI — the terminal as SDK client (design §4).
 *
 * Exit codes (computed once, here): 0 clean 1 error-severity signals 2 usage/config error (bad
 * flags, CONFIG_INVALID, ENTRYPOINT_*) 3 internal error 4 ran but produced zero measurements zero
 * measurements — CI never passes unmeasured)
 *
 * Stream discipline (clig): stdout carries findings — the report and its summary; stderr carries
 * the run's own errors and diagnostics — setup failures, failed units — plus structured logs
 * (default silent; --debug). Either stream stays usable with the other discarded.
 */

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { Type as TypeBoxType, type Static as TypeBoxStatic } from "@sinclair/typebox";
import { Value as TypeBoxValue } from "@sinclair/typebox/value";
import packageJson from "../package.json";
import { loadConfig, defaultConfig, DEFAULT_CONFIG_PATH } from "./config/load.ts";
import { lint, collectReport, type LintReport } from "./core/lint.ts";
import { renderJson } from "./core/output/json.ts";
import { renderStylish } from "./core/output/stylish.ts";
import { MeasureError, SetupError, type InputKind } from "./core/types.ts";
import { log, setLogLevel } from "./logger.ts";
import type { ResolvedConfig } from "./config/load.ts";

const COLOR_MODE_SCHEMA = TypeBoxType.Union([
  TypeBoxType.Literal("auto"),
  TypeBoxType.Literal("always"),
  TypeBoxType.Literal("never"),
]);

/** CLI args boundary — validated with TypeBox like every external input. */
const CLI_ARGS_SCHEMA = TypeBoxType.Object({
  file: TypeBoxType.Optional(TypeBoxType.Array(TypeBoxType.String())),
  dir: TypeBoxType.Optional(TypeBoxType.String()),
  language: TypeBoxType.Optional(TypeBoxType.String()),
  kind: TypeBoxType.Optional(
    TypeBoxType.Union([
      TypeBoxType.Literal("file"),
      TypeBoxType.Literal("dir"),
      TypeBoxType.Literal("diff"),
      TypeBoxType.Literal("str"),
    ]),
  ),
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

const HELP = `jint — jev lint: measures code with AI-classifier judgments; rules in, signals out.

Usage:
  jint --file <path>...      measure on-disk files
  jint --dir <path>          measure a directory tree
  cat fix.patch | jint --kind diff   piped stdin, declared a diff
  cat snippet.ts | jint --kind str   piped stdin, declared one str unit
  jint                       no flags: input comes from jint.config.json

Examples:
  jint --file src/a.ts src/b.ts
  jint --dir src/
  git diff HEAD~1 | jint --kind diff
  cat snippet.ts | jint --kind str --language typescript
  jint --kind diff --json | jq .

A path's kind is never guessed from its content — a patch file read via --file is judged as a
FILE; pipe it with --kind diff to judge it as a diff. Piped stdin has no path, so its kind is
REQUIRED: pass --kind str or --kind diff (jint never shells out to git — the caller pipes the
diff in). The stdin str unit's identity is "input".

Options:
  --file <path>...    file(s) to measure (repeatable)
  --dir <path>        directory to measure
  --kind <kind>       input kind for piped stdin: str (one snippet unit) or diff (unified diff
                      text); required when stdin is piped, unused with --file/--dir
  --language <id>     tree-sitter grammar for piped-stdin/extensionless sources (e.g. typescript);
                      without a resolvable language, inventory-scoped rules fail WALK_FAILED
                      in-band and unit-scoped rules still measure
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

  const cliInput = inputFromFlags(cliArgs);
  if (cliInput.outcome === "usage-error") {
    usageError(cliInput.usageMessage);
    return 2;
  }

  // Input resolution: flags > stdin > config.input. A path's kind is inferred by shape; piped
  // stdin has no path, so its kind is REQUIRED (--kind str|diff — no default, no guessing).
  // EMPTY piped stdin falls through so config.input can flow. With a TTY or input flags, stdin
  // is never read; a TTY with no flags and no config input dies in lint()'s empty-input backstop.
  let stdinStr: { content: string } | undefined;
  let stdinDiff: { text: string } | undefined;
  if (cliInput.outcome === "selected" && cliInput.input === "") {
    const kindGuidance =
      "piped stdin requires --kind: pass --kind str (one source snippet) or --kind diff (a unified diff)";
    if (cliArgs.kind !== undefined && cliArgs.kind !== "str" && cliArgs.kind !== "diff") {
      usageError(
        `--kind ${cliArgs.kind}: paths already have their kind — use --file/--dir; --kind declares piped stdin (str|diff)`,
      );
      return 2;
    }
    if (cliArgs.kind === "str" || cliArgs.kind === "diff") {
      if (process.stdin.isTTY) {
        usageError(`--kind ${cliArgs.kind}: no piped stdin to measure (stdin is a terminal)`);
        return 2;
      }
      const content = await Bun.stdin.text();
      if (cliArgs.kind === "str") stdinStr = { content };
      else stdinDiff = { text: content };
    } else if (!process.stdin.isTTY) {
      const content = await Bun.stdin.text();
      if (content !== "") {
        usageError(kindGuidance);
        return 2;
      }
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
            : cliInput.input !== ""
              ? { input: cliInput.input, inputType: cliInput.inputType }
              : {}),
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
    return computeExit(lintReport);
  } catch (thrown) {
    return exitForThrown(thrown);
  }
}

/** ParseCliArgs result: validated flags, or a ready-to-print usage message. */
type CliArgsParse =
  | { outcome: "parsed"; cliArgs: CliArgs }
  | { outcome: "usage-error"; usageMessage: string };

function parseCliArgs(cliArgv: string[]): CliArgsParse {
  let nodeParsed: ReturnType<typeof parseArgs>;
  try {
    nodeParsed = parseArgs({
      args: cliArgv,
      options: {
        file: { type: "string", multiple: true },
        dir: { type: "string" },
        kind: { type: "string" },
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
      allowPositionals: true,
      strict: true,
    });
  } catch (thrown) {
    const parseFailureDetail = thrown instanceof Error ? thrown.message : String(thrown);
    return { outcome: "usage-error", usageMessage: `${parseFailureDetail} — see jint --help` };
  }
  if (!TypeBoxValue.Check(CLI_ARGS_SCHEMA, nodeParsed.values)) {
    const validationMessages = [...TypeBoxValue.Errors(CLI_ARGS_SCHEMA, nodeParsed.values)]
      .map((validationIssue) => `${validationIssue.path} ${validationIssue.message}`)
      .join("; ");
    return {
      outcome: "usage-error",
      usageMessage: `invalid arguments: ${validationMessages} — see jint --help`,
    };
  }
  const positionals = nodeParsed.positionals as string[];
  if (positionals.length > 0) {
    return {
      outcome: "usage-error",
      usageMessage: `unexpected argument '${positionals[0]}' — jint takes input via --file/--dir (did you mean --file ${positionals[0]}?)`,
    };
  }
  return { outcome: "parsed", cliArgs: nodeParsed.values as unknown as CliArgs };
}

/** The input the CLI flags select, in lint() terms — or a ready-to-print usage message. */
type CliInputSelection =
  | { outcome: "selected"; input: string | string[]; inputType?: InputKind }
  | { outcome: "usage-error"; usageMessage: string };

/**
 * Resolve input from flags; exactly one of --file/--dir may be given. Kinds are not flags for paths
 * — a path's kind is inferred by shape; --kind declares piped stdin only.
 */
function inputFromFlags(cliArgs: CliArgs): CliInputSelection {
  const selectedSources = [flagsSelectFiles(cliArgs), cliArgs.dir !== undefined].filter(Boolean);
  if (selectedSources.length > 1)
    return { outcome: "usage-error", usageMessage: "use only one of --file, --dir" };
  if (cliArgs.file !== undefined && cliArgs.file.length > 0)
    if (cliArgs.file !== undefined && cliArgs.file.length > 0)
      return { outcome: "selected", input: cliArgs.file, inputType: "file" };
  // config decides; lint() errors if empty
  if (cliArgs.dir !== undefined)
    return { outcome: "selected", input: cliArgs.dir, inputType: "dir" };
  return { outcome: "selected", input: "", inputType: undefined };
}

/** --file given with at least one path. */
function flagsSelectFiles(cliArgs: CliArgs): boolean {
  return cliArgs.file !== undefined && cliArgs.file.length > 0;
}

/**
 * Exit invariant: findings only — error-severity signals -> 1; zero measurements -> 4. Per-unit
 * MeasureErrors are signalled (streamed, printed on stderr) but never fail the run: a unit the
 * linter could not measure is reported, not treated as a lint violation.
 */
export function computeExit(lintReport: LintReport): number {
  if (lintReport.signals.some((signal) => signal.severity === "error")) return 1;
  if (lintReport.measurements.length === 0) return 4;
  return 0;
}

/** Boundary mapping, exactly once: setup -> 2, internal -> 3, an escaped measure error -> 4. */
function exitForThrown(thrown: unknown): number {
  const error =
    thrown instanceof SetupError || thrown instanceof MeasureError
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
    error.code === "NOT_SOURCE"
  )
    return 2;
  // A MeasureError that escaped the stream: the run happened but produced nothing
  if (error instanceof MeasureError) return 4;
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
