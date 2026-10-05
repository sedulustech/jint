<p align="center">
  <img src="logo.svg" width="220" alt="jint">
</p>

# jint

**jev lint** — classifies code with AI-classifier judgments (TypeSafe System One / jev) and turns the readings into actionable output via per-rule callbacks. Rules in, findings out.

```bash
bun add @typesafe-ai/sdk @sinclair/typebox   # jint's own deps, for reference
```

## The model

Three nouns, strictly separated:

- **rule** — the classifying mechanism: `{ name, criteria: { true, false }, target, handle }`. It holds one System One judgment (noul) over a state — criteria-as-rule: `true` is what makes the unit a 1, `false` what makes it a 0 (boundary cases live here) — plus a `handle` callback that reads the value.
- **measurement** — the raw noul value from jev for (rule, input). Always produced, never actionable by itself — _what is true_. A noul near 0.5 means undecided, not medium; values pass through untouched.
- **finding** — a measurement that cleared the rule's handle: `{ rule, input, value, severity }`. The only actionable thing: it drives the report and the exit code.

A rule classifies; its handle decides; a finding is a measurement that mattered.

## Config

`jint.config.json` is the default (pre-commit lint); other purposes name themselves (`jint.review.config.json`) and are selected with `--config`. The file is PLAIN JSON — no comments, no code, writable from any environment without Node or bun:

```json
{
  "$schema": "./node_modules/jint/jint.schema.json",
  "input": "src/",
  "exclude": []
}
```

Start it with `"$schema"` pointing at the checked-in `jint.schema.json` (shipped with the package) and editors autocomplete every key. The loader accepts and ignores `$schema` and any other extra top-level keys.

- **Input kind is inferred**, not configured: on-disk directory -> dir; on-disk file whose content looks like a unified diff -> diff; rev-looking string (`HEAD`, `HEAD~2..HEAD`, a sha) -> diff via git; `"-"` -> diff from stdin. `inputType` exists only as an override for ambiguous cases.
- **exclude** removes inputs (globs/paths). Defaults: `node_modules`, `.git`, gitignored paths, binary files.
- **Rules are data**: omit `rules` for the full default set; entries are either a default rule's name (`"is_greppable"`) or a full rule object (last wins per name). `disable` removes rules by name — set membership, not policy.
- **Per-rule scoping**: every rule (JSON and TS tier) accepts optional `"include"` and `"exclude"` glob lists over the walk's paths. `include` filters first (absent = the rule applies everywhere); `exclude` subtracts last and ALWAYS wins over include. Patterns reuse the global exclude's glob semantics — engine AND dirOnly: a trailing-slash pattern (`"tests/"`) names a directory and scopes out the whole subtree, a slashed pattern anchors (`"tests/**"`), a bare name matches a path ending in it; negated globs (`"!..."`) are rejected at load. Scoped-out elements cost zero jev calls and are never silent: one aggregated scope note per unit (one per rule at run level on the TS tier), serialized into `--json` output too. An exclude that fully cancels an include is legal and warned, never an error. Example: `examples/scoped-rules.config.json` (the tests/fixture exclusion — issue 008).
- **Run knobs**: `"concurrency"` (max in-flight classifier calls, run-wide; default 16, max 64 — the wall-clock knob), `"rps_budget"` (client-side request-arrival budget in requests/second; default 15, ~75% of the published 1,200 rpm quota — the compliance knob), and `"timeout"` (per-call classifier timeout in seconds; default 30 — a hung call becomes a per-element `JEV_TIMEOUT` failure instead of pinning a slot; liveness, not retry). Surface as CLI flags `--concurrency` / `--rps-budget` / `--timeout` (flags override config) and as `lint()` / `classify()` options. The report is deterministic: every array (findings, measurements, errors, notes) sorts on a total key (input, span, rule), so two runs of the same input serialize byte-identically regardless of completion order.
- **Handlers are typed data**, never code — the question type decides the valid shape. Noul rules (criteria `{ true, false }`) take `{ "warn": { "less_than"|"greater_than": n }, "error"?: { "less_than"|"greater_than": n }, "silent_band"?: [lo, hi] }`: each threshold names its own defect direction and ceiling (low-bad `{ "warn": { "less_than": 0.4 }, "error": { "less_than": 0.3 } }`; high-bad `{ "warn": { "greater_than": 0.55 }, "error": { "greater_than": 0.7 } }`), numbers are defect-pole confidence levels, both within (0, 1); `silent_band` keeps readings inside it silent (ordered, never containing a threshold), absent = everything surfaces. Choice rules (criteria array) take `{ "map": ("ok"|"warn"|"error")[] }`: one level per criterion, direction expressed by the map itself (high-bad `["ok","ok","warn","error"]`; high-good `["error","warn","ok","ok"]`); length must equal the criteria count and at least one level is non-"ok" — a fired level's finding message defaults to that criterion's line. Every rule ships a real handle; probing measures — read the `--json` measurements and discard findings (the handle only decides when readings surface; the null-handle measure-only form was retired with the required-policy change).

Override a default's calibration by re-declaring the rule by name — a threshold change is a paste-able diff, no runtime required:

```json
{
  "input": "src/",
  "rules": [
    {
      "name": "is_name_purposeful",
      "criteria": {
        "true": "names state purpose; style is not judged",
        "false": "a name reveals implementation or is a bare generic"
      },
      "target": "definitions",
      "handle": { "fires_when": "false", "warn_at": 0.6, "error_at": 0.7 }
    }
  ]
}
```

## Default rules

Thresholds are anchored to the calibration corpora — jint's own src/ as the primary corpus, the sibling-repo baselines as the external cross-check: healthy runs produce zero errors; the calibration mutants (bad names, comment bloat, obfuscation) are caught. Treat the defaults as a starting point rather than a verdict on your codebase: they are calibrated to make the tool useful out of the box, and the expectation is that you will tune them once you know what your code looks like. Every rule can be re-declared by name with your own criteria and handle — a paste-able diff that takes effect without any runtime — so the pricing of a threshold is entirely in your hands. What jint ships is less a fixed opinion than the platform to hold your own: rules in, findings out, typed data end to end, and the freedom to decide what a reading should mean for your project.

| rule                              | polarity           | error     | warn      | healthy range                             |
| --------------------------------- | ------------------ | --------- | --------- | ----------------------------------------- |
| `is_name_purposeful`              | high = good        | < 0.3     | < 0.4     | 0.43 – 0.85                               |
| `is_vocabulary_consistent`        | high = good        | < 0.6     | < 0.75    | 0.86 – 0.89                               |
| `is_naming_convention_consistent` | high = good        | < 0.65    | < 0.75    | 0.82 – 0.95                               |
| `is_greppable`                    | high = good        | < 0.60    | < 0.75    | 0.81 – 0.84                               |
| `is_comment_narration`            | high = bad         | > 0.45    | > 0.30    | 0.09 – 0.21                               |
| `is_comment_patching_readability` | high = bad         | > 0.55    | > 0.40    | 0.11 – 0.15                               |
| `will_comment_drift`              | high = bad         | > 0.7     | > 0.55    | 0.19 – 0.36                               |
| `will_error_lose_cause`           | high = bad         | > 0.7     | > 0.4     | unanchored                                |
| `is_cognitively_complex`          | high = bad (score) | score ≥ 2 | score ≥ 1 | noul baselines stale — pending re-measure |
| `is_function_srp`                 | high = good        | < 0.3     | < 0.45    | 0.54 – 0.96                               |
| `is_filename_fitting`             | high = bad         | > 0.55    | > 0.75    | 0.04 – 0.33                               |
| `is_readable`                     | high = bad         | score > 2 | score > 1 | unanchored                                |

`cyclomatic_complexity` is deliberately absent: it is exactly computable in code (deterministic things stay deterministic). readability is classified by `is_readable`, a choice-kind rule scored on a 0–3 rubric (see below) — the earlier aggregate `readability` reading was retired as insensitive in mutant testing. `excessive_comments` is retired under the single-attribute doctrine: "too many comments" is a superset of attributes that move in opposite directions — narration should shrink where a readability patch grows — so the superset averages its own readings into noise. Each comment attribute below is classified on its own; the aggregate of clean readings is what a decision reads.

### Writing a new rule: one rule = one attribute, ambiguity is the worst criteria

Every rule classifies exactly one attribute. A rule whose criteria bundles several attributes ("too many comments", "well-designed function") cannot produce an actionable finding: the attributes move in opposite directions, so the noul value averages their mixture into noise, and the finding cannot say what to fix. Before adding a rule, split the idea until each remaining piece is a single yes/no attribute that a single fix action addresses; if a piece is computable in code (counts, structure, casing rules), it does not become a rule at all — deterministic things stay deterministic. The criteria's true/false sides must then state that one attribute without hedging: boundary cases belong in `false`, and words like "well-designed", "good", or "clean" are the smell of an unsplit idea. Editing criteria is a re-calibration event (see the thresholds above).

- `is_comment_narration` — comments that merely restate what the code already says. High = bad.
- `is_comment_patching_readability` — comments compensating for code that should read itself. High = bad (code smell).
- `will_comment_drift` — comments pinning specific artifacts by name (files, functions, parameters, constants) whose renaming silently invalidates the comment. High = bad.

- `is_filename_fitting` — a source file's name names the responsibility its body actually carries (the only rule that sees the path, so it alone catches "json.ts whose body renders HTML reports"). High = bad; thresholds from the two-language filename-fit probe: healthy max 0.36 (TypeScript) / 0.33 (Go) against defective min 0.88 / 0.60.
- `is_function_srp` — a function carries one cohesive responsibility its name and docblock state. High = good; thresholds provisional, pending self-corpus anchoring.
- `will_error_lose_cause` — error handling loses information: errors swallowed, rethrown without cause, or replaced by messages dropping the original failure detail. High = bad; thresholds from the seam-purity probe, unanchored until the self-lint corpus re-classifies them.
- `is_readable` — choice-kind rule (not a noul proposition): the classifier scores `definitions` on a 0–3 rubric, 0 = "names, structure, and types make the story obvious" up to 3 = "dense, misleading names, or structure that fights the problem". Warn at 1+, error at 2+; thresholds unanchored until the self-lint corpus has score readings.

The m3 comment-bloat calibration mutant is caught by `is_comment_narration` on per-file units (0.47–0.56 against the healthy 0.09–0.19); the whole-diff mutant reading dilutes, as whole-diff units always have.

## CLI

```bash
jint src/                                # a directory tree
jint src/a.ts src/b.ts                   # explicit files
git diff --name-only HEAD~1 | jint -     # a changed-file LIST from stdin (your pipeline)
cat snippet.ts | jint str -              # piped stdin, one str unit
jint                                     # no positional: input comes from jint.config.json
```

Flags: `--rule <name>` `--config` `--exclude <glob>` `--disable <name>` `--language <id>` `--json` `--color auto|always|never` `--debug` `-h/--help` `--version`.

Precedence: command noun > stdin > `TYPESAFE_*` environment > `jint.config.json` > defaults.

Stream discipline (clig): stdout carries findings — the stylish table or the `--json` machine shape `jint-report/v1` (errors ride in it as data). stderr carries the run's own errors and diagnostics — setup failures, failed units — plus structured logs, silent by default (`--debug` or `LOG_LEVEL` to enable). Either stream stays usable with the other discarded. Color only on a TTY; `NO_COLOR`/`TERM=dumb`/`--color=never` suppress it, so piping is always clean.

## Inputs

jint accepts, as input, one of:

| input                                 | invocation                                         |
| ------------------------------------- | -------------------------------------------------- |
| one or more paths (files, or one dir) | `jint src/` · `jint a.ts b.ts`                     |
| a string                              | `jint str "export const x = 1"` · piped: `cat f.ts | jint str -` |
| a changed-file LIST (stdin)           | `git diff --name-only HEAD~1                       | jint -`     |
| a changed-file LIST (file)            | `jint --changed changed.txt`                       |

### Linting a changeset

The killer flow is two commands, composed — jint never shells out and never parses a VCS; your git pipeline is your own:

```bash
# selection: judge exactly what changed
git diff --name-only HEAD~1 | jint -

# the same, scoped and ruled
git diff --name-only origin/main.. | jint - --rule is_name_purposeful
```

For rules that should KNOW what changed (without changing what is judged), the list also feeds the ctx.diff lens: `jint src/ --changed changed.txt` populates `ctx.diff` for TS rules — see the TS-rules section. A bare list carries no added/modified/removed distinction; if you want git's classification, cut it yourself (`git diff --name-status | cut -f2`) — jint takes one flat list, one path per line, relative to the input dir or absolute. Entries that resolve to no walked file are reported as notes ("not found in the walk"), never silent.

Content-aware diff rules (judging the patch text itself) are composition, not a flag: `git diff | jint str -` with diff-shape rules — or the ctx.sources follow-on.

### The noun grammar

The resource is the noun; the verb (classify) is implicit. `str` is a noun only as the FIRST positional; the next positional is its payload, taken verbatim — no flag parsing — so `jint str "--json"` classifies `--json` as source. Nouns never resolve to filesystem paths: a repo file named `str` is classified as `jint ./str`, a `str` payload that names an existing path is rejected (exit 2) — inline source or `-` only, classify the file as `jint <path>` — and bare `jint str` (no payload) is a usage error. One input per invocation.

A path's kind is inferred by shape only: exists-as-dir -> `dir`, anything else -> `file`; a missing path is `ENTRYPOINT_NOT_FOUND` (exit 2). Content is never sniffed — a patch file passed as a path is judged as a FILE, and a `.diff`/`.patch` extension is not a source-language grammar, so it fails `NOT_SOURCE`.

### Piped stdin: declared, never guessed

stdin has no default kind. `jint str -` reads ONE str unit (identity `str:stdin`); `jint -` reads a changed-file LIST (see above). Piping without either is a usage error (exit 2) with guidance; a TTY with payload `-` errors immediately instead of blocking on the terminal. Empty piped stdin falls through to `config.input`.

```bash
cat snippet.ts | jint str - --json
cat snippet.ts | jint str - --language typescript --rule is_function_srp
```

- `--` ends flag parsing for dash-paths (`jint -- --weird.ts`). Flags may appear before or after positionals (`jint --json src/` == `jint src/ --json`).
- `--language <id>` names the tree-sitter grammar for extensionless sources (e.g. stdin); valid ids: typescript, python, go — an unknown id is a usage error (exit 2). Without a resolvable language, inventory-scoped rules fail `WALK_FAILED` in-band and unit-scoped rules still classify.
- There is no `--classify` flag: `--json` already carries every measurement; handles only affect findings and the exit code.
- The removed `--file`/`--dir`/`--kind`/`--diff` flags error with a pointer at the new form (the diff noun itself is removed: a patch file is just a file, and the changed list is `jint -` / `--changed`).

### Language notes

Go (`.go`) decomposes with the shared role vocabulary (function/method -> function, struct/interface -> type, package-level const/var -> binding); its rule criteria are unverified until probed.

## Exit codes

| code | meaning                                                                                                                                                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | clean (measurements, no error-severity findings)                                                                                                                                                                                        |
| 1    | error-severity findings found                                                                                                                                                                                                           |
| 2    | usage/config error (bad flags, unknown `--language`, `CONFIG_INVALID`, entrypoint not found/unreadable)                                                                                                                                 |
| 3    | internal error                                                                                                                                                                                                                          |
| 4    | ran but classified nothing (zero measurements) or any unit failed to classify — a partial run is still a failed run (CI can never pass an unclassified or half-classified input). Per-unit errors are signalled on stderr, never thrown |

## Errors

Classify before handling: cannot-start failures throw; per-unit failures stream as values and never abort the run — but any failed unit fails the run's exit code (4): a judgment that never existed cannot be passed by CI. The exit is decided by error-severity findings (1) over failed units (4). There is no degradation tier: a unit the linter cannot classify (including one that cannot be parsed into elements) is a per-unit error, not a partial result.

- **SetupError** (thrown) — the run cannot start: `CONFIG_INVALID`, `ENTRYPOINT_NOT_FOUND`, `ENTRYPOINT_UNREADABLE`, and `INTERNAL` for invariant violations (exit 2/3).
- **ClassifyError** (streamed value) — one unit failed to produce a measurement, so no judgment ever exists for it: `JEV_AUTH`, `JEV_UNAVAILABLE`, `JEV_REQUEST_INVALID`, `JEV_RESPONSE_INVALID` name request-layer causes; `WALK_FAILED` names a unit that could not be mapped to elements (unmapped language, unparseable source); `INTERNAL` for an unclassifiable classifier-adjacent throw. One bad unit never kills the run and never fails it by itself; they land in `report.errors` and print on stderr.
  There is no whole-file fallback: if a file cannot be mapped to elements, its inventory-scoped rules fail for that unit (a `WALK_FAILED` error in `report.errors`); unit-scoped rules (`files`/`diffs`) judge the unit itself and were never affected.

jev is called through `@typesafe-ai/sdk` (`client.systemOne({ state, questions })`, model `jev-latest`, one batched call per input). `TYPESAFE_API_KEY` is required; a missing or rejected key fails loud (`JEV_AUTH`) at the first call. `src/core/jev/client.ts` is the only file importing the SDK — the swappable backend seam (`lint()` accepts any `classifier`).

## TS rules

The JSON tier above is the default. When a rule needs more — pairing a comment with the code it annotates, sibling comparisons, composed state — write it in TypeScript and declare the file in the config:

```json
{
  "input": "src/",
  "rules": [],
  "tsRules": ["lint-rules/paired-comments.ts"]
}
```

A TS rule file is a config FRAGMENT: it default-exports `defineConfig({ rules: [...] })` from the virtual module `jint:sdk` (runtime-injected, unshadowable; types via `/// <reference path="./node_modules/jint/src/core/tsrules/sdk.d.ts" />`). Fragments contribute `rules` ONLY — `input`/`exclude` stay run-level. Rule names share one namespace across both tiers (duplicates are fatal at load).

A rule declares a REQUEST (`target`: a role, a list of them, or an `(elements) => Element[]` selection function evaluated once per run), a compiler (`classify(self, ctx)` — returns the state spec for one element; `ctx.targets` is the resolved slice; `self.parent` is the enclosing element), and EXACTLY ONE policy: declarative `handle` (the typed noul handler — same shape as JSON noul rules) or `handleClassification(results, ctx)` — called once, returning one `{ severity, message?, data? }` per result, aligned by index. The rule never calls the classifier; jint does, and every call is dumped like any other (`JEV_RECORD`). See `examples/rules/is-comment-paired.ts` for the worked pairing rule.

Guarantees and limits (v1): imports are gated — only `jint:*`, relative, and absolute (a static pre-scan; dynamic `import()` inside a rule bypasses it, documented, not supported); handlers are sync-only; a throwing handler is `RULE_FAILED` — per-unit, non-fatal, but the run exits 4; hangs are unsupported (no time budget yet). State is composed freely — observability (the dumps), not restriction, is the guarantee.

### The ctx.diff lens

Give the run a changed-file list (`jint -`, or `--changed <file>`) and every TS rule's `ctx` gains `ctx.diff`: `{ paths, file, functions, definitions, comments, imports }` — `paths` is the list (verbatim, deduplicated, walked entries only) and each key is `ctx.targets.<kind>` filtered to elements whose input path is in it. `ctx.diff` is `undefined` when no list was given, and defined-but-empty when the list matched nothing — a rule can distinguish absence from empty, and the seed rule (`examples/rules/docs-fit-diff.ts`) treats a defined-but-empty lens as LOUD (a warn finding), never a silent pass. diff is knowledge about the judged things: rules that never read it are untouched by its presence. Loading, execution, and the full contract: `tmp/designs/rules-context/01..04`.

## SDK

The CLI is one consumer; `lint()` is the product:

Config (jint.config.json) is declarative data; the SDK is programmatic — `lint()` takes a resolved config whose rules carry real function handles:

```ts
import { defaultConfig, lint, collectReport } from "jint";

const report = await collectReport(
  lint({
    config: { ...defaultConfig(), input: "src/" },
    input: "src/a.ts", // optional override; inferred otherwise
    classifier: mySwappableJudge, // optional; defaults to the jev adapter
  }),
);
// report: { measurements, findings, errors }
```

`lint()` is an AsyncIterable of events (`measurement` / `finding` / `error`) — results stream as they are judged.

### `classify()` — the one-shot measurement door

Call jint with ANY str and ANY rules and get measurements — no files, no config:

```ts
import { classify, type Rule } from "jint";

const rules: readonly Rule[] = [
  {
    name: "is_greppable",
    target: "files",
    handle: (v) => (v < 0.6 ? { severity: "error" } : null),
    criteria: { true: "every name greps to one concept", false: "a name is a placeholder or pun" },
  },
];

const { measurements, errors, inventory } = await classify(str, rules, {
  path: "snippet.ts", // identity + grammar detection; default "str:stdin"
  language: "typescript", // explicit grammar for extensionless sources
  classifier: myJudge, // optional; defaults to the jev adapter
  concurrency: 16, // run-wide in-flight-call ceiling (default 16, max 64)
  rps_budget: 15, // request-arrival budget, requests/second (default 15)
  timeout: 30, // per-call timeout, seconds; a hung call becomes JEV_TIMEOUT
});
```

Unit-scoped rules (`files`/`diffs`) judge the whole str in one call; inventory-scoped rules have the inventory derived internally (tree-sitter) and judge each element in its own one-element call — never the matrix form. Decompose failure is a `WALK_FAILED` in `errors` (never thrown); unit-scoped rules still classify.

This is the measurement-only door: handles are never applied and no findings are produced — raw readings and in-band `ClassifyError`s only. Interpretation is lint's job.

## Install

Prebuilt macOS binaries ship as release artifacts (`out/jint-darwin-arm64.tar.gz`, `out/jint-darwin-x64.tar.gz`) — no bun needed:

```bash
curl -LO <release-url>/jint-darwin-arm64.tar.gz   # or -x64
tar -xzf jint-darwin-arm64.tar.gz && ./jint --help
```

`TYPESAFE_API_KEY` must be set in the environment (jev calls fail loud with `JEV_AUTH` otherwise).

## Development

```bash
bun install
bun test            # 100+ tests incl. calibration checks against tmp/diff-v4
bun run validate    # schema -> typecheck -> lint -> build
bun run build       # emit packages/cli/dist (tsc -p packages/cli); schema first, it is checked in
bun packages/cli/src/cli.ts --help      # from source
bun packages/cli/dist/cli.js --help     # from the build (bun runtime: the CLI uses Bun.stdin/file/spawn)
```

The build uses tsc emit (not `bun build --compile`) because the package manifest ships `main`/`types` from `./dist` with `files: ["dist", "src"]` — a per-module JS + `.d.ts` tree. `jint.schema.json` is not a build output: the runtime loader never reads it, it exists for editor autocomplete and ships via the `files` field.

State shapes: file/dir inputs classifier `{ path, content }`; diff inputs classifier `{ path, diff, commit_message }` — the calibrated tmp/diff-v4 shape, so the validated numbers transfer.
