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
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  ClassifyError,
  SetupError,
  checkRunKnobs,
  collectReport,
  describeRules,
  selectRules,
  defaultConfig,
  knownLanguages,
  lint,
  loadConfig,
  renderJson,
  renderLines,
  recordSummary,
  recordRunManifest,
  recordRunReport,
  DEFAULT_CONFIG_PATH,
  type InputKind,
  type LintReport,
  type ResolvedConfig,
  type Rule,
} from "@jint/sdk";
import { selectionEcho } from "@jint/sdk";
import { Type as TypeBoxType, type Static as TypeBoxStatic } from "@sinclair/typebox";
import { Value as TypeBoxValue } from "@sinclair/typebox/value";
import packageJson from "../package.json";
import { log, setLogLevel } from "./logger.ts";

/** CLI args boundary — validated with TypeBox like every external input. */
const CLI_ARGS_SCHEMA = TypeBoxType.Object({
  language: TypeBoxType.Optional(TypeBoxType.String()),
  config: TypeBoxType.Optional(TypeBoxType.String()),
  json: TypeBoxType.Optional(TypeBoxType.Boolean()),
  "dry-run": TypeBoxType.Optional(TypeBoxType.Boolean()),
  debug: TypeBoxType.Optional(TypeBoxType.Boolean()),
  exclude: TypeBoxType.Optional(TypeBoxType.Array(TypeBoxType.String())),
  disable: TypeBoxType.Optional(TypeBoxType.Array(TypeBoxType.String())),
  rule: TypeBoxType.Optional(TypeBoxType.Array(TypeBoxType.String())),
  concurrency: TypeBoxType.Optional(TypeBoxType.String()),
  "rps-budget": TypeBoxType.Optional(TypeBoxType.String()),
  timeout: TypeBoxType.Optional(TypeBoxType.String()),
  changed: TypeBoxType.Optional(TypeBoxType.String()),
  help: TypeBoxType.Optional(TypeBoxType.Boolean()),
  version: TypeBoxType.Optional(TypeBoxType.Boolean()),
});

type CliArgs = TypeBoxStatic<typeof CLI_ARGS_SCHEMA>;

const HELP = `jint — jev lint: classifies code with AI-classifier judgments; rules in, findings out.

Usage:
  jint src/                       classify a directory tree
  jint a.ts b.ts                  classify files
  git diff --name-only HEAD~1 | jint -   a changed-file LIST from stdin (with no other input,
                                         the list is what gets judged)
  cat snippet.ts | jint str -     piped stdin, one str unit
  jint                            no positional: input comes from jint.config.json

Element-scoped runs: address one element directly —
  jint src/a.ts@L58              the element whose span contains line 58 (one classifier call)
ANCHOR @L<n>: the element whose span contains line n (one call). RANGE @L<s>-<e>: every element
FULLY ENCLOSED in [s,e] — partial overlaps never selected; a range enclosing none is an error
naming the file's element spans. Comma list @L<s>-<e>,@L<s>-<e>: each item independent. Each
selected element is one classifier call (its rules batched); --rule narrows every selection to ONE.
Finding line nouns paste back as file@L<line> — element ids are run-scoped and never selectable.
Verifying one fix: the finding's @L is pre-edit (edits shift lines) - re-check at the
  element's CURRENT line: jint src/a.ts@L<current-line> --rule <rule>   one call;
  a full re-run closes the loop (when it pays: the skill's fix-loop section).

The resource is the noun; the verb (classify) is implicit. str is a noun only as the
FIRST positional; the next positional is its payload, taken verbatim — no flag parsing:
jint str "--json" classifies "--json" as source. Nouns never resolve to paths — a file named
str is reached as jint ./str, and a str payload that names an existing path is rejected
(inline source or '-' only; classify the file as jint <path>). A path's kind is inferred by shape only (exists-as-dir -> dir,
else file); content is never sniffed. A bare '-' positional is the changed-file LIST from stdin
(your VCS pipeline: git diff --name-only HEAD~1 | jint -). --
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
  --concurrency <n>   max in-flight classifier calls, run-wide (default 16, max 64; overrides
                      the config key of the same name)
  --rps-budget <n>    client-side request-start budget, requests/second (default 15, ~75% of
                      the published 1200 rpm quota; overrides config rps_budget)
  --timeout <secs>    per-call classifier timeout (default 30; a hung call becomes a per-element
                      JEV_TIMEOUT failure - liveness, not retry)
  --changed <file>    changed-file LIST (one path per line, relative to the input dir or
                      absolute); with no other input, the list IS the judged subject (the
                      changeset form: git diff --name-only HEAD~1 | jint -)
  --json              machine report (byte-identical to the run's report.json) instead of
                      raw finding lines
  --dry-run           print the rule set that WOULD run (config resolved, disable/only applied)
                      and exit 0 - zero input walks, zero classifier calls
  --debug             structured debug logs on stderr
  -h, --help          this help
  --version           print the version

Exit codes: 0 clean, 1 error findings, 2 usage/config, 3 internal, 4 zero measurements.

`;

/**
 * End-of-run stderr notice for run recording: where the requests went and how many. Nothing when
 * recording is disabled (JEV_RECORD=0); recording always reports, even zero requests (the run may
 * have failed before any classifier call).
 */
export function recordNotice(): string {
  const record = recordSummary();
  if (record === null) return "";
  const override = record.override ? " (override: JEV_DIR)" : "";
  return `jint: requests -> ${record.dir} (${record.count} calls)${override}\n`;
}

/**
 * The stderr rules pre-print: header + full-prose rule descriptions (SDK describeRules) + a ts-rule
 * count note when the config declares TS-tier rules (their names load at run time, so only the
 * count prints here — never claim fewer rules than the run uses). The block is the rubric in the
 * consumer's context BEFORE the findings; stdout stays untouched. The CLI owns this function's
 * voice; the SDK owns describeRules (same block, neutral).
 */
export function printRules(effective: readonly Rule[], tsCount: number): void {
  const tsNote =
    tsCount > 0 ? ` + ${tsCount} ts rule${tsCount === 1 ? "" : "s"} (loaded at run time)` : "";
  process.stderr.write(
    `jint: measuring with ${effective.length} rules${tsNote}\n\n` + describeRules(effective),
  );
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
  // The config file that ran (absolute); null when no config file exists (built-in defaults).
  const configPath =
    cliArgs.config !== undefined
      ? resolve(cliArgs.config)
      : existsSync(DEFAULT_CONFIG_PATH)
        ? resolve(DEFAULT_CONFIG_PATH)
        : null;

  // Input resolution precedence: command noun > stdin > config.input > error. A positional
  // path's kind is inferred by shape (exists-as-dir -> dir, else file — inference is exactly
  // that); piped stdin is DECLARED by a noun (jint str -) or is a changed-list (jint -), never
  // guessed. EMPTY
  // piped stdin falls through so config.input can flow (a closed or /dev/null stdin is the
  // config-only invocation shape). A TTY is never read; a TTY with payload "-" dies here, not
  // blocking on the terminal, and a TTY with no noun and no config input dies in lint()'s
  // empty-input backstop.
  let stdinStr: { content: string } | undefined;
  let lintInput: { input: string | string[]; inputType?: InputKind } | undefined;
  let elementScope: FileSelector | undefined;
  const positionals = parsedCliArgs.positionals;
  const firstPositional = positionals[0];
  if (firstPositional === "-") {
    // The changed-file LIST from stdin: the user's own VCS pipeline
    // (git diff --name-only HEAD~1 | jint -). Never a judged subject — a noun declares those.
    // stdin is NOT consumed here: the changed-list resolver in lint() reads it lazily.
    if (process.stdin.isTTY) {
      usageError("jint -: no piped stdin to read the changed list from (stdin is a terminal)");
      return 2;
    }
  }
  if (firstPositional === "str") {
    // Nouns never resolve to filesystem paths (a repo file named 'str' is reached as ./str);
    // the payload is the raw next positional, consumed without flag interpretation.
    const payload = positionals[1];
    if (payload === undefined) {
      usageError('jint str expects a payload — use: jint str - (piped stdin) or jint str <"code">');
      return 2;
    }
    if (payload === "-") {
      if (process.stdin.isTTY) {
        usageError("jint str -: no piped stdin to classify (stdin is a terminal)");
        return 2;
      }
      stdinStr = { content: await Bun.stdin.text() };
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
  } else if (positionals.length > 0 && firstPositional !== "-") {
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
    // Element selector on a file noun (path@L<n>): exactly one selected file, judged as one
    // element. A selector on multiple positionals or on a directory is a caller contradiction —
    // say so before any input is touched.
    const selectors = positionals.map((p) => parseFileSelector(p));
    const pasted = selectors.find((sel) => sel.pastedId === true);
    if (pasted !== undefined) {
      usageError(
        `element ids are run-scoped and cannot select across runs — query by file@L, e.g. jint ${pasted.path.split("#")[0]}@L58`,
      );
      return 2;
    }
    const bad = selectors.find((sel) => sel.badRange !== undefined);
    if (bad !== undefined) {
      usageError(
        `bad line span "${bad.path}@${bad.badRange}" - use @L<line> or @L<start>-<end>,... with start <= end (see jint --help)`,
      );
      return 2;
    }
    const selected = selectors.filter(
      (sel) => sel.anchor !== undefined || sel.ranges !== undefined,
    );
    if (selected.length > 1) {
      usageError("one element selector per run — select from a single file");
      return 2;
    }
    if (selected.length === 1) {
      const sel = selected[0]!;
      if (selectors.length > 1) {
        usageError(
          `an element selector selects one file — classify the others separately: jint ${sel.path}`,
        );
        return 2;
      }
      if (existsSync(sel.path) && statSync(sel.path).isDirectory()) {
        usageError(`${sel.path} is a directory — element selectors take files`);
        return 2;
      }
      elementScope = sel;
      lintInput = { input: sel.path };
    } else {
      // shape inference: exists-as-dir -> dir, else file
      lintInput =
        positionals.length === 1
          ? { input: positionals[0]! }
          : { input: positionals, inputType: "file" };
    }
  } else if (!process.stdin.isTTY && firstPositional !== "-") {
    const content = await Bun.stdin.text();
    if (content !== "") {
      usageError(
        "piped stdin needs a kind — use: jint str - (one source snippet) or jint - (a changed-file list: git diff --name-only HEAD~1 | jint -)",
      );
      return 2;
    }
  }

  // Run knobs: flags override the config; all funnel into the SDK options (thin-client rule).
  const concurrency = numericFlag(cliArgs.concurrency, "--concurrency");
  const rpsBudget = numericFlag(cliArgs["rps-budget"], "--rps-budget");
  const timeout = numericFlag(cliArgs.timeout, "--timeout");
  const knobProblem = checkRunKnobs({ concurrency, rps_budget: rpsBudget, timeout });
  if (knobProblem !== null) {
    usageError(knobProblem + " — see jint --help");
    return 2;
  }

  // The effective rule set — config rules filtered by --disable/--rule — shared by the stderr
  // pre-print and --dry-run, so the block always names exactly what the run will classify.
  const effective = selectRules(resolvedConfig.rules, [], cliArgs.disable, cliArgs.rule).json;

  // --dry-run: resolve + validate everything (config errors, knobs), print the effective rule
  // set, and stop BEFORE any input walk or classifier call. No requests dir, no record notice,
  // empty stdout — the block is the whole payload (rubric before reading, for free).
  if (cliArgs["dry-run"] === true) {
    printRules(effective, resolvedConfig.tsRules?.length ?? 0);
    return 0;
  }

  try {
    // The rubric lands in the consumer's context BEFORE the findings it interprets:
    // full prose, stderr, never on stdout. Findings carry rule names; this block is the only
    // place their meaning lives in-band (context timing, not artifact embedding — output can
    // be sub-sampled, context cannot).
    printRules(effective, resolvedConfig.tsRules?.length ?? 0);
    const lintReport = await collectReport(
      lint({
        config: resolvedConfig,
        // No flags and no stdin: pass NO input key so lint()'s ?? config.input fallback
        // applies ("" would shadow the config — lint() keeps the empty-input backstop).
        ...(stdinStr !== undefined
          ? { str: stdinStr, language: cliArgs.language }
          : (lintInput ?? {})),
        exclude: cliArgs.exclude,
        disable: cliArgs.disable,
        only: cliArgs.rule,
        concurrency,
        rps_budget: rpsBudget,
        timeout,
        changed: firstPositional === "-" ? "-" : cliArgs.changed,
        ...(elementScope !== undefined && {
          element: {
            path: elementScope.path,
            ...(elementScope.anchor !== undefined && { anchor: elementScope.anchor }),
            ...(elementScope.ranges !== undefined && { ranges: elementScope.ranges }),
          },
        }),
      }),
    );
    // One canonical artifact: renderJson's bytes ARE report.json AND the --json stdout. The
    // default stdout is the raw-line projection of the same report (findings only); totals and
    // run errors stay on stderr. Persistence is NEVER gated on --json — the flag is a stdout
    // format choice (output-architecture design).
    const reportJson = renderJson(lintReport);
    const runId = recordSummary()?.dir.split("/").pop();
    const rendered =
      cliArgs.json === true ? { stdout: reportJson, stderr: "" } : renderLines(lintReport, runId);
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
    process.stderr.write(rendered.stderr);
    // The element-scoped content echo: resolution map + edge sections, stderr only (stdout stays
    // pure finding data). Failure of the run itself already reported — never double-report.
    if (elementScope !== undefined) {
      const echo = await selectionEcho(elementScope, lintReport.findings);
      if (echo !== "") process.stderr.write(echo);
    }
    const exit = computeExit(lintReport);
    process.stderr.write(recordNotice());
    return exit;
  } catch (thrown) {
    return exitForThrown(thrown);
  }
}

/** ParseArgs carries number flags as strings; coerce, naming the flag on a bad value. */
function numericFlag(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (value.trim() === "") {
    usageError(`${flag} requires a number, got an empty value — see jint --help`);
    return undefined;
  }
  const n = Number(value);
  if (Number.isNaN(n)) {
    usageError(`${flag} must be a number, got '${value}' — see jint --help`);
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

/** Flags removed by the noun grammar; each error points at the new form. */
const REMOVED_FLAGS: Readonly<Record<string, string>> = {
  "--file": "use: jint <path>... (e.g. jint src/a.ts)",
  "--dir": "use: jint <dir> (e.g. jint src/)",
  "--kind": "use: jint str - (piped source); a changed-file list is jint - (stdin)",
  "--diff":
    "the diff noun was removed - pipe a changed-file list: git diff --name-only HEAD~1 | jint -",
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
  "--exclude",
  "--disable",
  "--rule",
  "--concurrency",
  "--rps-budget",
  "--timeout",
  "--changed",
  "--json",
  "--dry-run",
  "--debug",
  "--help",
  "-h",
  "--version",
]);

function isFlagToken(token: string): boolean {
  if (!token.startsWith("-") || token === "-") return false;
  return KNOWN_FLAGS.has(token.split("=")[0]!);
}

const NOUNS: ReadonlySet<string> = new Set(["str"]);

/** Modifier flags that take a value token; their value must ride with them into parseArgs. */
const VALUED_FLAGS: ReadonlySet<string> = new Set([
  "--language",
  "--config",
  "--exclude",
  "--disable",
  "--rule",
  "--concurrency",
  "--rps-budget",
  "--timeout",
  "--changed",
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
        "dry-run": { type: "boolean" },
        debug: { type: "boolean" },
        exclude: { type: "string", multiple: true },
        disable: { type: "string", multiple: true },
        rule: { type: "string", multiple: true },
        concurrency: { type: "string" },
        "rps-budget": { type: "string" },
        timeout: { type: "string" },
        changed: { type: "string" },
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
    error.code === "CONFIG_NO_RULES" ||
    error.code === "ENTRYPOINT_NOT_FOUND" ||
    error.code === "ENTRYPOINT_UNREADABLE" ||
    error.code === "NOT_SOURCE" ||
    error.code === "RULE_INVALID" ||
    error.code === "ELEMENT_NOT_FOUND"
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
