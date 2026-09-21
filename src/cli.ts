#!/usr/bin/env bun
/**
 * jint CLI — the terminal as SDK client (design §4).
 *
 * Exit codes (computed once, here):
 *   0  clean
 *   1  error-severity signals
 *   2  usage/config error (bad flags, CONFIG_INVALID, ENTRYPOINT_*)
 *   3  internal error
 *   4  ran but failed (any diagnostic, or zero measurements — CI never passes unmeasured)
 *
 * stdout carries only the report; logs go to stderr (default silent; --debug).
 */

import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { Type as TypeBoxType, type Static as TypeBoxStatic } from "@sinclair/typebox";
import { Value as TypeBoxValue } from "@sinclair/typebox/value";
import packageJson from "../package.json";
import { loadConfig, defaultConfig, DEFAULT_CONFIG_PATH } from "./config/load.ts";
import type { ResolvedConfig } from "./config/define.ts";
import { lint, collectReport, type LintReport } from "./core/lint.ts";
import { AppError, type InputKind } from "./core/types.ts";
import { renderJson } from "./core/output/json.ts";
import { renderStylish } from "./core/output/stylish.ts";
import { log, setLogLevel } from "./logger.ts";

const ColorModeSchema = TypeBoxType.Union([
  TypeBoxType.Literal("auto"),
  TypeBoxType.Literal("always"),
  TypeBoxType.Literal("never"),
]);

/** CLI args boundary — validated with TypeBox like every external input. */
const CliArgsSchema = TypeBoxType.Object({
  file: TypeBoxType.Optional(TypeBoxType.Array(TypeBoxType.String())),
  dir: TypeBoxType.Optional(TypeBoxType.String()),
  diff: TypeBoxType.Optional(TypeBoxType.String()),
  config: TypeBoxType.Optional(TypeBoxType.String()),
  json: TypeBoxType.Optional(TypeBoxType.Boolean()),
  debug: TypeBoxType.Optional(TypeBoxType.Boolean()),
  color: TypeBoxType.Optional(ColorModeSchema),
  exclude: TypeBoxType.Optional(TypeBoxType.Array(TypeBoxType.String())),
  disable: TypeBoxType.Optional(TypeBoxType.Array(TypeBoxType.String())),
  help: TypeBoxType.Optional(TypeBoxType.Boolean()),
  version: TypeBoxType.Optional(TypeBoxType.Boolean()),
});

type CliArgs = TypeBoxStatic<typeof CliArgsSchema>;

const HELP = `jint — jev lint: measures code with AI-classifier judgments; sensors in, signals out.

Usage:
  jint --file <path>...      measure on-disk files
  jint --dir <path>          measure a directory tree
  jint --diff <spec>         measure a diff: "-" (stdin), a patch file, or a git rev
  jint                       no flags: input comes from jint.config.ts

Examples:
  jint --file src/a.ts src/b.ts
  jint --dir src/
  jint --diff HEAD~2..HEAD
  jint --diff fix.patch
  git diff HEAD~1 | jint --diff -
  jint --diff HEAD~1..HEAD --json | jq .

Options:
  --file <path>...    file(s) to measure (repeatable)
  --dir <path>        directory to measure
  --diff <spec>       diff input: "-", a *.patch path, or a rev expression
  --config <path>     config file (default: jint.config.ts)
  --exclude <glob>    input exclusion, on top of config (repeatable)
  --disable <name>    sensor removal by name, on top of config (repeatable)
  --json              machine report (jint-report/v1) instead of the human table
  --color <mode>      auto | always | never (default: auto — color only on a TTY)
  --debug             structured debug logs on stderr
  -h, --help          this help
  --version           print the version

Config precedence: flags > jint.config.ts > defaults. Auth comes from TYPESAFE_API_KEY (used as-is, no jint-specific env vars).
Sensors: naming_precision, naming_consistency, greppable_identifiers (high = good),
excessive_comments, cognitive_complexity (high = bad). Each carries an overridable
handle: (value) => "error" | "warn" | null.

Exit codes: 0 clean; 1 error signals; 2 usage/config; 3 internal; 4 ran but failed.
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
    resolvedConfig = cliArgs.config !== undefined
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

  try {
    const lintReport = await collectReport(
      lint({
        config: resolvedConfig,
        input: cliInput.input,
        inputType: cliInput.inputType,
        exclude: cliArgs.exclude,
        disable: cliArgs.disable,
      }),
    );
    const renderedReport = cliArgs.json === true
      ? renderJson(lintReport)
      : renderStylish(lintReport, cliArgs.color ?? "auto");
    process.stdout.write(renderedReport);
    return computeExit(lintReport);
  } catch (thrown) {
    return exitForThrown(thrown);
  }
}

/** parseCliArgs result: validated flags, or a ready-to-print usage message. */
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
        diff: { type: "string" },
        config: { type: "string" },
        json: { type: "boolean" },
        debug: { type: "boolean" },
        color: { type: "string" },
        exclude: { type: "string", multiple: true },
        disable: { type: "string", multiple: true },
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
  if (!TypeBoxValue.Check(CliArgsSchema, nodeParsed.values)) {
    const validationMessages = [...TypeBoxValue.Errors(CliArgsSchema, nodeParsed.values)].map((validationIssue) => `${validationIssue.path} ${validationIssue.message}`).join("; ");
    return { outcome: "usage-error", usageMessage: `invalid arguments: ${validationMessages} — see jint --help` };
  }
  const positionals = nodeParsed.positionals as string[];
  if (positionals.length > 0) {
    return { outcome: "usage-error", usageMessage: `unexpected argument '${positionals[0]}' — jint takes input via --file/--dir/--diff (did you mean --file ${positionals[0]}?)` };
  }
  return { outcome: "parsed", cliArgs: nodeParsed.values as unknown as CliArgs };
}

/** The input the CLI flags select, in lint() terms — or a ready-to-print usage message. */
type CliInputSelection =
  | { outcome: "selected"; input: string | string[]; inputType?: InputKind }
  | { outcome: "usage-error"; usageMessage: string };

/** Resolve input from flags; exactly one of --file/--dir/--diff may be given. Returns a usage message on conflict. */
function inputFromFlags(cliArgs: CliArgs): CliInputSelection {
  const selectedSources = [flagsSelectFiles(cliArgs), cliArgs.dir !== undefined, cliArgs.diff !== undefined].filter(Boolean);
  if (selectedSources.length > 1) return { outcome: "usage-error", usageMessage: "use only one of --file, --dir, --diff" };
  if (cliArgs.diff !== undefined) return { outcome: "selected", input: cliArgs.diff, inputType: "diff" };
  if (cliArgs.file !== undefined && cliArgs.file.length > 0) return { outcome: "selected", input: cliArgs.file, inputType: "file" };
  if (cliArgs.dir !== undefined) return { outcome: "selected", input: cliArgs.dir, inputType: "dir" };
  return { outcome: "selected", input: "", inputType: undefined }; // config decides; lint() errors if empty
}

/** --file given with at least one path. */
function flagsSelectFiles(cliArgs: CliArgs): boolean {
  return cliArgs.file !== undefined && cliArgs.file.length > 0;
}

/** Exit invariant (design §7): error signals -> 1; diagnostics or zero measurements -> 4. */
export function computeExit(lintReport: LintReport): number {
  if (lintReport.signals.some((signal) => signal.severity === "error")) return 1;
  if (lintReport.diagnostics.length > 0 || lintReport.measurements.length === 0) return 4;
  return 0;
}

/** Boundary mapping, exactly once: config/entrypoint -> 2, internal -> 3, run-phase -> 4. */
function exitForThrown(thrown: unknown): number {
  const appError = thrown instanceof AppError
    ? thrown
    : new AppError("INTERNAL", thrown instanceof Error ? thrown.message : String(thrown), { cause: thrown });
  log("error", appError.message, { errorCode: appError.code });
  process.stderr.write(`jint: ${appError.code}: ${appError.message}\n`);
  if (appError.code === "CONFIG_INVALID" || appError.code === "ENTRYPOINT_NOT_FOUND" || appError.code === "ENTRYPOINT_UNREADABLE") return 2;
  if (appError.code === "INTERNAL") return 3;
  return 4; // JEV_* that escaped the stream: the run happened but failed
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
