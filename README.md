# jint

**jev lint** — measures code with AI-classifier judgments (TypeSafe System One / jev) and turns the readings into actionable output via per-rule callbacks. Rules in, findings out.

```bash
bun add @typesafe-ai/sdk @sinclair/typebox   # jint's own deps, for reference
```

## The model

Three nouns, strictly separated:

- **rule** — the measuring mechanism: `{ name, criteria: { true, false }, target, handle }`. It holds one System One judgment (noul) over a state — criteria-as-rule: `true` is what makes the unit a 1, `false` what makes it a 0 (boundary cases live here) — plus a `handle` callback that reads the value.
- **measurement** — the raw noul value from jev for (rule, input). Always produced, never actionable by itself — _what is true_. A noul near 0.5 means undecided, not medium; values pass through untouched.
- **finding** — a measurement that cleared the rule's handle: `{ rule, input, value, severity }`. The only actionable thing: it drives the report and the exit code.

A rule measures; its handle decides; a finding is a measurement that mattered.

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
- **Handles are data**, never code: `{ "warn_at": n, "error_at": n }`, both required, they must differ. Polarity is inferred from their ordering — `warn_at < error_at` is high-bad (a value above warn_at warns, above error_at errors); `error_at < warn_at` is high-good (a value below warn_at warns, below error_at errors). `"handle": null` is measure-only: the measurement streams, nothing ever produces findings.

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
      "handle": { "warn_at": 0.6, "error_at": 0.5 }
    }
  ]
}
```

## Default rules

Thresholds are anchored to the calibration corpora — jint's own src/ as the primary corpus, the sibling-repo baselines as the external cross-check: healthy runs produce zero errors; the calibration mutants (bad names, comment bloat, obfuscation) are caught.

| rule                              | polarity    | error     | warn      | healthy range |
| --------------------------------- | ----------- | --------- | --------- | ------------- |
| `is_name_purposeful`              | high = good | < 0.3     | < 0.4     | 0.43 – 0.85   |
| `is_vocabulary_consistent`        | high = good | < 0.6     | < 0.75    | 0.86 – 0.89   |
| `is_naming_convention_consistent` | high = good | < 0.65    | < 0.75    | 0.82 – 0.95   |
| `is_greppable`                    | high = good | < 0.60    | < 0.75    | 0.81 – 0.84   |
| `is_comment_narration`            | high = bad  | > 0.45    | > 0.30    | 0.09 – 0.21   |
| `is_comment_patching_readability` | high = bad  | > 0.55    | > 0.40    | 0.11 – 0.15   |
| `will_comment_drift`              | high = bad  | > 0.7     | > 0.55    | 0.19 – 0.36   |
| `will_error_lose_cause`           | high = bad  | > 0.7     | > 0.4     | unanchored    |
| `is_cognitively_complex`          | high = bad  | > 0.6     | > 0.45    | 0.19 – 0.32   |
| `is_function_srp`                 | high = good | < 0.3     | < 0.45    | 0.54 – 0.96   |
| `is_filename_fitting`             | high = bad  | > 0.55    | > 0.75    | 0.04 – 0.33   |
| `is_readable`                     | high = bad  | score > 2 | score > 1 | unanchored    |

`cyclomatic_complexity` is deliberately absent: it is exactly computable in code (deterministic things stay deterministic). readability is measured by `is_readable`, a choice-kind rule scored on a 0–3 rubric (see below) — the earlier aggregate `readability` reading was retired as insensitive in mutant testing. `excessive_comments` is retired under the single-attribute doctrine: "too many comments" is a superset of attributes that move in opposite directions — narration should shrink where a readability patch grows — so the superset averages its own readings into noise. Each comment attribute below is measured on its own; the aggregate of clean readings is what a decision reads.

### Writing a new rule: one rule = one attribute, ambiguity is the worst criteria

Every rule measures exactly one attribute. A rule whose criteria bundles several attributes ("too many comments", "well-designed function") cannot produce an actionable finding: the attributes move in opposite directions, so the noul value averages their mixture into noise, and the finding cannot say what to fix. Before adding a rule, split the idea until each remaining piece is a single yes/no attribute that a single fix action addresses; if a piece is computable in code (counts, structure, casing rules), it does not become a rule at all — deterministic things stay deterministic. The criteria's true/false sides must then state that one attribute without hedging: boundary cases belong in `false`, and words like "well-designed", "good", or "clean" are the smell of an unsplit idea. Editing criteria is a re-calibration event (see the thresholds above).

- `is_comment_narration` — comments that merely restate what the code already says. High = bad.
- `is_comment_patching_readability` — comments compensating for code that should read itself. High = bad (code smell).
- `will_comment_drift` — comments pinning specific artifacts by name (files, functions, parameters, constants) whose renaming silently invalidates the comment. High = bad.

- `is_filename_fitting` — a source file's name names the responsibility its body actually carries (the only rule that sees the path, so it alone catches "json.ts whose body renders HTML reports"). High = bad; thresholds from the two-language filename-fit probe: healthy max 0.36 (TypeScript) / 0.33 (Go) against defective min 0.88 / 0.60.
- `is_function_srp` — a function carries one cohesive responsibility its name and docblock state. High = good; thresholds provisional, pending self-corpus anchoring.
- `will_error_lose_cause` — error handling loses information: errors swallowed, rethrown without cause, or replaced by messages dropping the original failure detail. High = bad; thresholds from the seam-purity probe, unanchored until the self-lint corpus re-measures them.
- `is_readable` — choice-kind rule (not a noul proposition): the classifier scores `definitions` on a 0–3 rubric, 0 = "names, structure, and types make the story obvious" up to 3 = "dense, misleading names, or structure that fights the problem". Warn at 1+, error at 2+; thresholds unanchored until the self-lint corpus has score readings.

The m3 comment-bloat calibration mutant is caught by `is_comment_narration` on per-file units (0.47–0.56 against the healthy 0.09–0.19); the whole-diff mutant reading dilutes, as whole-diff units always have.

## CLI

```bash
jint src/                                # a directory tree
jint src/a.ts src/b.ts                   # explicit files
git diff HEAD~1 | jint diff -            # piped stdin, declared a diff
jint diff fix.patch                      # a patch file, declared a diff
cat snippet.ts | jint str -              # piped stdin, one str unit
jint                                     # no positional: input comes from jint.config.json
```

Flags: `--rule <name>` `--config` `--exclude <glob>` `--disable <name>` `--language <id>` `--json` `--color auto|always|never` `--debug` `-h/--help` `--version`.

Precedence: command noun > stdin > `TYPESAFE_*` environment > `jint.config.json` > defaults.

Stream discipline (clig): stdout carries findings — the stylish table or the `--json` machine shape `jint-report/v1` (errors ride in it as data). stderr carries the run's own errors and diagnostics — setup failures, failed units — plus structured logs, silent by default (`--debug` or `LOG_LEVEL` to enable). Either stream stays usable with the other discarded. Color only on a TTY; `NO_COLOR`/`TERM=dumb`/`--color=never` suppress it, so piping is always clean.

A diff input decomposes into per-file units: added/modified files are measured, deleted and binary files are skipped. Jint never shells out to git — the caller pipes the diff in.

### The noun grammar

The resource is the noun; the verb (measure) is implicit. `str` and `diff` are nouns only as the FIRST positional; the next positional is their payload, taken verbatim — no flag parsing — so `jint str "--json"` measures `--json` as source. Nouns never resolve to filesystem paths: a repo file named `diff` is measured as `jint ./diff`, and bare `jint diff` / `jint str` (no payload) are usage errors. One input per invocation.

A path's kind is inferred by shape only: exists-as-dir -> `dir`, anything else -> `file`; a missing path is `ENTRYPOINT_NOT_FOUND` (exit 2). Content is never sniffed — a patch file passed as a path is judged as a FILE, and a `.diff`/`.patch` extension is not a source-language grammar, so it fails `NOT_SOURCE`. To judge a patch as a diff, declare it: `jint diff fix.patch`.

### Piped stdin: declared by a noun, never guessed

stdin has no default kind. `jint diff -` reads a unified diff (decomposed into per-file units); `jint str -` reads ONE str unit (identity `str:stdin`). Piping without a noun is a usage error (exit 2) with guidance; bare `jint -` likewise; a TTY with payload `-` errors immediately instead of blocking on the terminal. Empty piped stdin falls through to `config.input`.

```bash
cat snippet.ts | jint str - --json
cat snippet.ts | jint str - --language typescript --rule is_function_srp
```

- `--` ends flag parsing for dash-paths (`jint -- --weird.ts`). Flags may appear before or after positionals (`jint --json src/` == `jint src/ --json`).
- `--language <id>` names the tree-sitter grammar for extensionless sources (e.g. stdin); valid ids: typescript, python, go — an unknown id is a usage error (exit 2). Without a resolvable language, inventory-scoped rules fail `WALK_FAILED` in-band and unit-scoped rules still measure.
- There is no `--measure` flag: `--json` already carries every measurement; handles only affect findings and the exit code.
- The removed `--file`/`--dir`/`--kind`/`--diff` flags error with a pointer at the new form.

### Language notes

Go (`.go`) decomposes with the shared role vocabulary (function/method -> function, struct/interface -> type, package-level const/var -> binding); its rule criteria are unverified until probed.

## Exit codes

| code | meaning                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | clean (measurements, no error-severity findings)                                                                                                                  |
| 1    | error-severity findings found                                                                                                                                     |
| 2    | usage/config error (bad flags, unknown `--language`, `CONFIG_INVALID`, entrypoint not found/unreadable)                                                           |
| 3    | internal error                                                                                                                                                    |
| 4    | ran but measured nothing — zero measurements (CI can never pass an unmeasured diff). Per-unit errors are signalled on stderr but never fail the run by themselves |

## Errors

Classify before handling: cannot-start failures throw; per-unit failures stream as values and never fail the run by themselves — the run is failed only by findings. There is no degradation tier: a unit the linter cannot measure (including one that cannot be parsed into elements) is a per-unit error, not a partial result.

- **SetupError** (thrown) — the run cannot start: `CONFIG_INVALID`, `ENTRYPOINT_NOT_FOUND`, `ENTRYPOINT_UNREADABLE`, and `INTERNAL` for invariant violations (exit 2/3).
- **MeasureError** (streamed value) — one unit failed to produce a measurement, so no judgment ever exists for it: `JEV_AUTH`, `JEV_UNAVAILABLE`, `JEV_REQUEST_INVALID`, `JEV_RESPONSE_INVALID` name request-layer causes; `WALK_FAILED` names a unit that could not be mapped to elements (unmapped language, unparseable source); `INTERNAL` for an unclassifiable classifier-adjacent throw. One bad unit never kills the run and never fails it by itself; they land in `report.errors` and print on stderr.
  There is no whole-file fallback: if a file cannot be mapped to elements, its inventory-scoped rules fail for that unit (a `WALK_FAILED` error in `report.errors`); unit-scoped rules (`files`/`diffs`) judge the unit itself and were never affected.

jev is called through `@typesafe-ai/sdk` (`client.systemOne({ state, questions })`, model `jev-latest`, one batched call per input). `TYPESAFE_API_KEY` is required; a missing or rejected key fails loud (`JEV_AUTH`) at the first call. `src/core/jev/client.ts` is the only file importing the SDK — the swappable backend seam (`lint()` accepts any `classifier`).

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
    handle: (v) => (v < 0.6 ? "error" : null),
    criteria: { true: "every name greps to one concept", false: "a name is a placeholder or pun" },
  },
];

const { measurements, errors, inventory } = await classify(str, rules, {
  path: "snippet.ts", // identity + grammar detection; default "str:stdin"
  language: "typescript", // explicit grammar for extensionless sources
  classifier: myJudge, // optional; defaults to the jev adapter
  concurrency: 8, // per-element call cap
});
```

Unit-scoped rules (`files`/`diffs`) judge the whole str in one call; inventory-scoped rules have the inventory derived internally (tree-sitter) and judge each element in its own one-element call — never the matrix form. Decompose failure is a `WALK_FAILED` in `errors` (never thrown); unit-scoped rules still measure.

This is the measurement-only door: handles are never applied and no findings are produced — raw readings and in-band `MeasureError`s only. Interpretation is lint's job.

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
bun run build       # emit dist/ (tsc -p tsconfig.build.json); schema first, it is checked in
bun src/cli.ts --help      # from source
bun dist/cli.js --help     # from the build (bun runtime: the CLI uses Bun.stdin/file/spawn)
```

The build uses tsc emit (not `bun build --compile`) because the package manifest ships `main`/`types` from `./dist` with `files: ["dist", "src"]` — a per-module JS + `.d.ts` tree. `jint.schema.json` is not a build output: the runtime loader never reads it, it exists for editor autocomplete and ships via the `files` field.

State shapes: file/dir inputs classifier `{ path, content }`; diff inputs classifier `{ path, diff, commit_message }` — the calibrated tmp/diff-v4 shape, so the validated numbers transfer.
