# jint

**jev lint** — measures code with AI-classifier judgments (TypeSafe System One / jev) and turns the readings into actionable output via per-rule callbacks. Rules in, signals out.

```bash
bun add @typesafe-ai/sdk @sinclair/typebox   # jint's own deps, for reference
```

## The model

Three nouns, strictly separated:

- **rule** — the measuring mechanism: `{ name, criteria: { true, false }, target, handle }`. It holds one System One judgment (noul) over a state — criteria-as-rule: `true` is what makes the unit a 1, `false` what makes it a 0 (boundary cases live here) — plus a `handle` callback that reads the value.
- **measurement** — the raw noul value from jev for (rule, input). Always produced, never actionable by itself — _what is true_. A noul near 0.5 means undecided, not medium; values pass through untouched.
- **signal** — a measurement that cleared the rule's handle: `{ rule, input, value, severity }`. The only actionable thing: it drives the report and the exit code.

A rule measures; its handle decides; a signal is a measurement that mattered.

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
- **Handles are data**, never code: `{ "warn_at": n, "error_at": n }`, both required, they must differ. Polarity is inferred from their ordering — `warn_at < error_at` is high-bad (a value above warn_at warns, above error_at errors); `error_at < warn_at` is high-good (a value below warn_at warns, below error_at errors). `"handle": null` is measure-only: the measurement streams, nothing ever signals.

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

| rule                              | polarity    | error      | warn       | healthy range |
| --------------------------------- | ----------- | ---------- | ---------- | ------------- |
| `is_name_purposeful`              | high = good | < 0.5      | < 0.6      | 0.80 – 0.89   |
| `is_vocabulary_consistent`        | high = good | < 0.6      | < 0.75     | 0.86 – 0.89   |
| `is_naming_convention_consistent` | high = good | < 0.65     | < 0.85     | 0.89 – 0.91   |
| `is_greppable`                    | high = good | < 0.60     | < 0.75     | 0.81 – 0.84   |
| `is_comment_business_context`     | high = good | null in v0 | null in v0 | 0.31 – 0.84   |
| `is_comment_narration`            | high = bad  | > 0.45     | > 0.30     | 0.09 – 0.21   |
| `is_comment_patching_readability` | high = bad  | > 0.55     | > 0.40     | 0.11 – 0.15   |
| `will_comment_drift`              | high = bad  | > 0.7      | > 0.55     | 0.19 – 0.36   |
| `is_cognitively_complex`          | high = bad  | > 0.6      | > 0.45     | 0.19 – 0.32   |

`cyclomatic_complexity` is deliberately absent: it is exactly computable in code (deterministic things stay deterministic). `readability` is retired (insensitive in mutant testing). `excessive_comments` is retired under the single-attribute doctrine: "too many comments" is a superset of attributes that move in opposite directions — narration should shrink where a readability patch grows — so the superset averages its own signal into noise. Each comment attribute below is measured on its own; the aggregate of clean readings is what a decision reads.

### Writing a new rule: one rule = one attribute, ambiguity is the worst criteria

Every rule measures exactly one attribute. A rule whose criteria bundles several attributes ("too many comments", "well-designed function") cannot produce an actionable signal: the attributes move in opposite directions, so the noul value averages their mixture into noise, and the finding cannot say what to fix. Before adding a rule, split the idea until each remaining piece is a single yes/no attribute that a single fix action addresses; if a piece is computable in code (counts, structure, casing rules), it does not become a rule at all — deterministic things stay deterministic. The criteria's true/false sides must then state that one attribute without hedging: boundary cases belong in `false`, and words like "well-designed", "good", or "clean" are the smell of an unsplit idea. Editing criteria is a re-calibration event (see the thresholds above).

- `is_comment_business_context` — comments that explain WHY the code exists or why this approach was chosen. High is a virtue; low is not automatically bad (not all code needs recorded context), so its handle is null in v0: the measurement streams, nothing signals, and users who want to enforce context requirements override the handle.
- `is_comment_narration` — comments that merely restate what the code already says. High = bad.
- `is_comment_patching_readability` — comments compensating for code that should read itself. High = bad (code smell).
- `will_comment_drift` — comments pinning specific artifacts by name (files, functions, parameters, constants) whose renaming silently invalidates the comment. High = bad.

The m3 comment-bloat calibration mutant is caught by `is_comment_narration` on per-file units (0.47–0.56 against the healthy 0.09–0.19); the whole-diff mutant reading dilutes, as whole-diff units always have.

## CLI

```bash
jint --file src/a.ts src/b.ts     # explicit files
jint --dir src/                   # a directory tree
jint --diff HEAD~2..HEAD          # rev expression (shells out to git)
jint --diff fix.patch             # a file holding a unified diff
git diff HEAD~1 | jint --diff -   # stdin: the primitive
jint                              # no flags: input comes from jint.config.json
```

Flags: `--file` `--dir` `--diff` `--config` `--exclude <glob>` `--disable <name>` `--json` `--color auto|always|never` `--debug` `-h/--help` `--version`.

Precedence: flags > `TYPESAFE_*` environment > `jint.config.json` > defaults.

Stream discipline (clig): stdout carries findings — the stylish table or the `--json` machine shape `jint-report/v1` (errors ride in it as data). stderr carries the run's own errors and diagnostics — setup failures, failed units — plus structured logs, silent by default (`--debug` or `LOG_LEVEL` to enable). Either stream stays usable with the other discarded. Color only on a TTY; `NO_COLOR`/`TERM=dumb`/`--color=never` suppress it, so piping is always clean.

A diff input decomposes into per-file units: added/modified files are measured, deleted and binary files are skipped, and the commit message (when available via git) is shared state for every unit.

### Piped stdin: the str primitive

Piping into jint with NO input flags (`--file`/`--dir`/`--diff` all absent, stdin not a TTY) measures stdin as ONE str unit; its identity is `"input"`. Stdin is never a diff — `--diff -` stays the explicit diff door, no disambiguation:

```bash
cat snippet.ts | jint --json
cat snippet.ts | jint --language typescript --rule is_function_srp
```

- `--language <id>` names the tree-sitter grammar for extensionless sources (e.g. stdin). Without a resolvable language, inventory-scoped rules fail `MAPPING_FAILED` in-band and unit-scoped rules still measure.
- There is no `--measure` flag: `--json` already carries every measurement; handles only affect findings and the exit code.

## Exit codes

| code | meaning                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | clean (measurements, no error-severity signals)                                                                                                                   |
| 1    | error-severity signals found                                                                                                                                      |
| 2    | usage/config error (bad flags, `CONFIG_INVALID`, entrypoint not found/unreadable)                                                                                 |
| 3    | internal error                                                                                                                                                    |
| 4    | ran but measured nothing — zero measurements (CI can never pass an unmeasured diff). Per-unit errors are signalled on stderr but never fail the run by themselves |

## Errors

Classify before handling: cannot-start failures throw; per-unit failures stream as values and never fail the run by themselves — the run is failed only by findings. There is no degradation tier: a unit the linter cannot measure (including one that cannot be parsed into elements) is a per-unit error, not a partial result.

- **SetupError** (thrown) — the run cannot start: `CONFIG_INVALID`, `ENTRYPOINT_NOT_FOUND`, `ENTRYPOINT_UNREADABLE`, and `INTERNAL` for invariant violations (exit 2/3).
- **MeasureError** (streamed value) — one unit failed to produce a measurement, so no judgment ever exists for it: `JEV_AUTH`, `JEV_UNAVAILABLE`, `JEV_REQUEST_INVALID`, `JEV_RESPONSE_INVALID` name request-layer causes; `MAPPING_FAILED` names a unit that could not be mapped to elements (unmapped language, unparseable source); `INTERNAL` for an unclassifiable classifier-adjacent throw. One bad unit never kills the run and never fails it by itself; they land in `report.errors` and print on stderr.
  There is no whole-file fallback: if a file cannot be mapped to elements, its inventory-scoped rules fail for that unit (a `MAPPING_FAILED` error in `report.errors`); unit-scoped rules (`files`/`diffs`) judge the unit itself and were never affected.

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
// report: { measurements, signals, errors }
```

`lint()` is an AsyncIterable of events (`measurement` / `signal` / `error`) — results stream as they are judged.

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
  path: "snippet.ts", // identity + grammar detection; default "input"
  language: "typescript", // explicit grammar for extensionless sources
  classifier: myJudge, // optional; defaults to the jev adapter
  concurrency: 8, // per-element call cap
});
```

Unit-scoped rules (`files`/`diffs`) judge the whole str in one call; inventory-scoped rules have the inventory derived internally (tree-sitter) and judge each element in its own one-element call — never the matrix form. Decompose failure is a `MAPPING_FAILED` in `errors` (never thrown); unit-scoped rules still measure.

This is the measurement-only door: handles are never applied and no signals are produced — raw readings and in-band `MeasureError`s only. Interpretation is lint's job.

## Development

```bash
bun install
bun test            # 100+ tests incl. calibration checks against tmp/diff-v4
tsc --noEmit       # typecheck
bun src/cli.ts --help
```

State shapes: file/dir inputs classifier `{ path, content }`; diff inputs classifier `{ path, diff, commit_message }` — the calibrated tmp/diff-v4 shape, so the validated numbers transfer.
