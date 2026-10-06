#!/usr/bin/env bun
/**
 * Jint CLI — the terminal as SDK client (design §4).
 *
 * Exit codes (computed once, here): 0 clean 1 error-severity findings 2 usage/config error (bad
 * flags, CONFIG_INVALID, ENTRYPOINT__, LIST__) 3 internal error 4 ran but classified nothing or any
 * unit failed to classify — CI never passes an unclassified or half-classified run)
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
import { Type as TypeBoxType } from "@sinclair/typebox";
import { Value as TypeBoxValue } from "@sinclair/typebox/value";
import packageJson from "../package.json";
import { log, setLogLevel } from "./logger.ts";

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
    blurb:
      "tree-sitter grammar for piped-stdin/extensionless sources; valid ids: typescript, python, go. Without a resolvable language, inventory-scoped rules fail WALK_FAILED in-band and unit-scoped rules still classify",
  },
  "--config": {
    type: "string",
    arg: "<path>",
    blurb:
      'config file, plain JSON (default: jint.config.json; autocomplete via the checked-in jint.schema.json "$schema" key)',
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
    blurb: "run ONLY these rules (repeatable); overrides --disable for the named set",
  },
  "--concurrency": {
    type: "string",
    arg: "<n>",
    blurb:
      "max in-flight classifier calls, run-wide (default 16, max 64; overrides the config key of the same name)",
  },
  "--rps-budget": {
    type: "string",
    arg: "<n>",
    blurb:
      "client-side request-start budget, requests/second (default 15, ~75% of the published 1200 rpm quota; overrides config rps_budget)",
  },
  "--timeout": {
    type: "string",
    arg: "<secs>",
    blurb:
      "per-call classifier timeout (default 30; a hung call becomes a per-element JEV_TIMEOUT failure - liveness, not retry)",
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
  "--debug": { type: "boolean", blurb: "structured debug logs on stderr" },
  "--help": { type: "boolean", aliases: ["-h"], blurb: "this help" },
  "--version": { type: "boolean", blurb: "print the version" },
} as const;

/** CLI args boundary — the schema is DERIVED from FLAGS, never a second hand-written shape. */
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
  Object.entries(FLAGS).map(([name, flag]) => [
    name.slice(2),
    {
      type: flag.type === "boolean" ? ("boolean" as const) : ("string" as const),
      ...(flag.type === "string[]" ? { multiple: true } : {}),
      ...("aliases" in flag ? { short: flag.aliases[0]!.slice(1) } : {}),
    },
  ]),
);

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
 * The noun table — the ONE source for the noun vocabulary and the position rule: a noun is the
 * FIRST positional, its next positional is the payload — exactly `payload` ("-", the declared stdin
 * read; there is no inline payload) — and nothing follows the payload. Dispatch reads this table;
 * no per-noun branch may exist. `example`/`blurb` render into the help Usage section; `hint` names
 * the remedy when a payload arrives in a now-dead form.
 */
export const NOUNS = {
  str: {
    payload: "-",
    example: "cat snippet.ts | jint str -",
    blurb: "piped stdin, one str unit",
  },
  paths: {
    payload: "-",
    example: "git diff --name-only HEAD~1 | jint paths -",
    blurb: "a path LIST from piped stdin",
    hint: "a list file is piped: jint paths - < list.txt",
  },
} as const;

/** The Usage section's noun rows, derived from the same table dispatch reads. */
const NOUN_ROWS = Object.values(NOUNS).map((noun) => ({ left: noun.example, right: noun.blurb }));

/** "jint str - = piped stdin, one str unit; jint paths - = a path LIST from piped stdin" */
const NOUN_DECLARATIONS = Object.entries(NOUNS)
  .map(([name, noun]) => `jint ${name} ${noun.payload} = ${noun.blurb}`)
  .join("; ");

/** "jint str - (piped stdin, one str unit) or jint paths - (a path LIST from piped stdin)" */
const NOUN_FORMS = Object.entries(NOUNS)
  .map(([name, noun]) => `jint ${name} ${noun.payload} (${noun.blurb})`)
  .join(" or ");

/** The full help text; the Options section is DERIVED from FLAGS. Exported for the derivation tests. */
export const HELP = `jint — jev lint: classifies code with AI-classifier judgments; rules in, findings out.

Usage:
${helpRows([
  { left: "jint src/", right: "classify a directory tree" },
  { left: "jint a.ts b.ts", right: "classify files" },
  ...NOUN_ROWS,
  { left: "jint", right: "no positional: input comes from jint.config.json" },
])}

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

The resource is the noun; the verb (classify) is implicit. A noun is the FIRST positional and
its next positional is the payload: '-', and nothing else — a noun declares how stdin is read;
there is no inline payload:
  ${NOUN_DECLARATIONS}
To judge a list from a file, pipe it: jint paths - < list.txt; to classify a file, pass the path.
Anything else after a noun is a usage error naming the correct form. Nouns never resolve to
paths — a file named str is reached as jint ./str. A path's kind is inferred by shape only
(exists-as-dir -> dir, else file); content is never sniffed. A bare '-' positional is undeclared —
name the noun: ${NOUN_FORMS}.
-- ends flag parsing for dash-paths: jint -- --weird.ts

Options:
${helpRows(OPTION_ROWS)}

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
  // that); piped stdin is DECLARED by a noun (jint str - for source, jint paths - for a path
  // list), never guessed. EMPTY piped stdin falls through so config.input can flow (a closed or
  // /dev/null stdin is the config-only invocation shape). A TTY is never read; a TTY with the
  // payload '-' dies here, not blocking on the terminal, and a TTY with no noun and no config
  // input dies in lint()'s empty-input backstop.
  let stdinStr: { content: string } | undefined;
  let lintInput: { input: string | string[]; inputType?: InputKind } | undefined;
  let elementScope: FileSelector | undefined;
  // The paths noun's payload: always '-' (stdin). stdin is NOT consumed here — the list resolver
  // in lint() reads it lazily.
  let pathsPayload: string | undefined;
  const positionals = parsedCliArgs.positionals;
  const firstPositional = positionals[0];
  if (firstPositional === "-") {
    // Bare '-' is undeclared: a dash is a payload, and a payload needs its noun. Say which.
    usageError(`bare '-' is undeclared — name the noun: ${NOUN_FORMS}`);
    return 2;
  }
  // The grammar, read off the NOUNS table in one place: a noun is the FIRST positional, its next
  // positional is the payload — '-' and nothing else — and nothing follows the payload. The noun
  // declares how stdin is read; there is no inline payload to protect from flag parsing.
  const nounName =
    firstPositional !== undefined && Object.hasOwn(NOUNS, firstPositional)
      ? (firstPositional as keyof typeof NOUNS)
      : undefined;
  if (nounName !== undefined) {
    const noun = NOUNS[nounName];
    const payload = positionals[1];
    if (payload === undefined) {
      usageError(`jint ${nounName} expects a payload — use: jint ${nounName} ${noun.payload}`);
      return 2;
    }
    if (payload !== noun.payload) {
      const hint = "hint" in noun ? ` (${noun.hint})` : "";
      usageError(
        `'${payload}' is not a payload — jint ${nounName} reads piped stdin: jint ${nounName} ${noun.payload}, and nothing follows it${hint}`,
      );
      return 2;
    }
    if (positionals.length > 2) {
      usageError(
        `nothing may follow the payload — jint ${nounName} ${noun.payload} is the whole input declaration (one noun per run)`,
      );
      return 2;
    }
    if (process.stdin.isTTY) {
      usageError(`jint ${nounName} ${noun.payload}: no piped stdin to read (stdin is a terminal)`);
      return 2;
    }
    // Nouns never resolve to filesystem paths (a repo file named 'str' is reached as ./str).
    if (nounName === "str") stdinStr = { content: await Bun.stdin.text() };
    // the path list: stdin is NOT consumed here — the list resolver in lint() reads it lazily
    else pathsPayload = payload;
  } else if (positionals.length > 0) {
    // File positionals: files may be many; a directory is exactly one path (the walk owns its
    // tree). A noun anywhere but FIRST is a misplaced declaration, and it is checked before
    // anything else. ONE consistent unknown-option rule next: a dash-leading positional that is
    // no known flag and no existing path is a mistyped flag (or a flag whose `--` separator the
    // bun runtime consumed) — say so, naming the token. An existing dash-leading file stays a
    // path, reachable verbatim after `--`.
    for (const positional of positionals) {
      if (Object.hasOwn(NOUNS, positional)) {
        usageError(
          `a noun is the FIRST positional — use: jint ${positional} ${NOUNS[positional as keyof typeof NOUNS].payload}`,
        );
        return 2;
      }
    }
    for (const positional of positionals) {
      if (positional.startsWith("-") && !existsSync(positional)) {
        usageError(`unknown option or missing path '${positional}' — see jint --help`);
        return 2;
      }
    }
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
          : { input: [...positionals], inputType: "file" };
    }
  }
  // Piped stdin is never guessed: with no str unit (stdin already consumed) and no paths noun
  // declaring the stdin list, a non-empty pipe is a usage error. An EMPTY pipe falls through so
  // config.input can flow (a closed or /dev/null stdin is the config-only invocation shape); a
  // TTY is never read.
  if (
    stdinStr === undefined &&
    lintInput === undefined &&
    pathsPayload === undefined &&
    !process.stdin.isTTY
  ) {
    const content = await Bun.stdin.text();
    if (content !== "") {
      usageError(
        "piped stdin needs a kind — use: jint str - (one source snippet) or jint paths - (a path list: git diff --name-only HEAD~1 | jint paths -)",
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
        paths: pathsPayload,
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
 * Split raw argv into modifier-flag tokens (for parseArgs) and positionals (for noun dispatch).
 * `--` ends flag parsing: everything after it is positional (dash-paths). Flags may appear before
 * or after positionals (jint --json src/ == jint src/ --json). A noun's next token rides with it as
 * the payload positional, so dispatch — not this scan — enforces the payload rule ('-', nothing
 * else); flag scanning resumes after the payload.
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
    error.code === "LIST_UNREADABLE" ||
    error.code === "LIST_ENTRY_INVALID" ||
    error.code === "LIST_EMPTY" ||
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
