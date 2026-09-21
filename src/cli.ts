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
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import pkg from "../package.json";
import { loadConfig, defaultConfig, DEFAULT_CONFIG_PATH } from "./config/load.ts";
import type { ResolvedConfig } from "./config/define.ts";
import { lint, collectReport, type LintReport } from "./core/lint.ts";
import { AppError, type InputKind } from "./core/types.ts";
import { renderJson } from "./core/output/json.ts";
import { renderStylish, type ColorMode } from "./core/output/stylish.ts";
import { log, setLogLevel } from "./logger.ts";

const ColorSchema = Type.Union([
  Type.Literal("auto"),
  Type.Literal("always"),
  Type.Literal("never"),
]);

/** CLI args boundary — validated with TypeBox like every external input. */
const ArgsSchema = Type.Object({
  file: Type.Optional(Type.Array(Type.String())),
  dir: Type.Optional(Type.String()),
  diff: Type.Optional(Type.String()),
  config: Type.Optional(Type.String()),
  json: Type.Optional(Type.Boolean()),
  debug: Type.Optional(Type.Boolean()),
  color: Type.Optional(ColorSchema),
  exclude: Type.Optional(Type.Array(Type.String())),
  disable: Type.Optional(Type.Array(Type.String())),
  help: Type.Optional(Type.Boolean()),
  version: Type.Optional(Type.Boolean()),
});

type Args = Static<typeof ArgsSchema>;

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
handle: v => "error" | "warn" | null.

Exit codes: 0 clean; 1 error signals; 2 usage/config; 3 internal; 4 ran but failed.
`;

export async function main(argv: string[]): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (typeof parsed === "string") {
    usageError(parsed);
    return 2;
  }
  const args = parsed;

  if (args.help === true) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.version === true) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (args.debug === true) setLogLevel("debug");

  let config: ResolvedConfig;
  try {
    config = args.config !== undefined
      ? await loadConfig(args.config)
      : existsSync(DEFAULT_CONFIG_PATH)
        ? await loadConfig()
        : defaultConfig();
  } catch (e) {
    return fail(e);
  }

  const input = inputFrom(args);
  if (typeof input === "string") {
    usageError(input);
    return 2;
  }

  try {
    const report = await collectReport(
      lint({
        config,
        input: input.value,
        inputType: input.kind,
        exclude: args.exclude,
        disable: args.disable,
      }),
    );
    const rendered = args.json === true
      ? renderJson(report)
      : renderStylish(report, (args.color as ColorMode | undefined) ?? "auto");
    process.stdout.write(rendered);
    return computeExit(report);
  } catch (e) {
    return fail(e);
  }
}

function parseCliArgs(argv: string[]): Args | string {
  let raw: ReturnType<typeof parseArgs>;
  try {
    raw = parseArgs({
      args: argv,
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
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return `${detail} — see jint --help`;
  }
  if (!Value.Check(ArgsSchema, raw.values)) {
    const messages = [...Value.Errors(ArgsSchema, raw.values)].map((err) => `${err.path} ${err.message}`).join("; ");
    return `invalid arguments: ${messages} — see jint --help`;
  }
  const positionals = raw.positionals as string[];
  if (positionals.length > 0) {
    return `unexpected argument '${positionals[0]}' — jint takes input via --file/--dir/--diff (did you mean --file ${positionals[0]}?)`;
  }
  return raw.values as unknown as Args;
}

/** Resolve input from flags; exactly one of --file/--dir/--diff may be given. Returns a usage message on conflict. */
function inputFrom(args: Args): { value: string | string[]; kind?: InputKind } | string {
  const given = [args.file !== undefined && args.file.length > 0, args.dir !== undefined, args.diff !== undefined].filter(Boolean);
  if (given.length > 1) return "use only one of --file, --dir, --diff";
  if (args.diff !== undefined) return { value: args.diff, kind: "diff" };
  if (args.file !== undefined && args.file.length > 0) return { value: args.file, kind: "file" };
  if (args.dir !== undefined) return { value: args.dir, kind: "dir" };
  return { value: "", kind: undefined }; // config decides; lint() errors if empty
}

/** Exit invariant (design §7): error signals -> 1; diagnostics or zero measurements -> 4. */
export function computeExit(report: LintReport): number {
  if (report.signals.some((s) => s.severity === "error")) return 1;
  if (report.diagnostics.length > 0 || report.measurements.length === 0) return 4;
  return 0;
}

/** Boundary mapping, exactly once: config/entrypoint -> 2, internal -> 3, run-phase -> 4. */
function fail(e: unknown): number {
  const err = e instanceof AppError
    ? e
    : new AppError("INTERNAL", e instanceof Error ? e.message : String(e), { cause: e });
  log("error", err.message, { errorCode: err.code });
  process.stderr.write(`jint: ${err.code}: ${err.message}\n`);
  if (err.code === "CONFIG_INVALID" || err.code === "ENTRYPOINT_NOT_FOUND" || err.code === "ENTRYPOINT_UNREADABLE") return 2;
  if (err.code === "INTERNAL") return 3;
  return 4; // JEV_* that escaped the stream: the run happened but failed
}

function usageError(message: string): void {
  process.stderr.write(`jint: ${message}\n`);
}

if (import.meta.main) {
  // EPIPE (from `| head`) exits cleanly, no stack trace; SIGINT exits non-zero, promptly.
  process.stdout.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EPIPE") process.exit(0);
    throw e;
  });
  process.on("SIGINT", () => process.exit(130));
  process.exitCode = await main(process.argv.slice(2));
}
