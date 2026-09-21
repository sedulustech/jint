# jint

**jev lint** — measures code with AI-classifier judgments (TypeSafe System One / jev) and turns the readings into actionable output via per-sensor callbacks. Sensors in, signals out.

```bash
bun add @typesafe-ai/sdk @sinclair/typebox   # jint's own deps, for reference
```

## The model

Three nouns, strictly separated:

- **sensor** — the measuring mechanism: `{ name, description, inputTypes, handle }`. It holds one System One judgment (noul) over a state, plus a `handle` callback that reads the value.
- **measurement** — the raw noul value from jev for (sensor, input). Always produced, never actionable by itself — _what is true_. A noul near 0.5 means undecided, not medium; values pass through untouched.
- **signal** — a measurement that cleared the sensor's handle: `{ sensor, input, value, severity }`. The only actionable thing: it drives the report and the exit code.

A sensor measures; its handle decides; a signal is a measurement that mattered.

## Config

`jint.config.ts` is the default (pre-commit lint); other purposes name themselves (`jint.review.config.ts`) and are selected with `--config`. That is the whole surface:

```ts
import { defineConfig, sensors } from "jint";

export default defineConfig({
  input: "src/",
  sensors: { ...sensors.defaults, disable: [] },
  exclude: [],
});
```

- **Input kind is inferred**, not configured: on-disk directory -> dir; on-disk file whose content looks like a unified diff -> diff; rev-looking string (`HEAD`, `HEAD~2..HEAD`, a sha) -> diff via git; `"-"` -> diff from stdin. `inputType` exists only as an override for ambiguous cases.
- **exclude** removes inputs (globs/paths). Defaults: `node_modules`, `.git`, gitignored paths, binary files.
- **disable** removes sensors by name — set membership, not policy.
- **Sensors carry their own policy**: each sensor ships a visible, overridable `handle: (value) => "error" | "warn" | null`. `null` is silent. Override by re-declaring the sensor by name:

```ts
sensors: {
  ...sensors.defaults,
  is_name_purposeful: {
    ...sensors.defaults.is_name_purposeful,
    handle: (v) => (v < 0.5 ? "error" : null),
  },
},
```

## Default sensors

Thresholds are anchored to the calibration corpora — jint's own src/ as the primary corpus, the sibling-repo baselines as the external cross-check: healthy runs produce zero errors; the calibration mutants (bad names, comment bloat, obfuscation) are caught.

| sensor                            | polarity    | error      | warn       | healthy range |
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
jint                              # no flags: input comes from jint.config.ts
```

Flags: `--file` `--dir` `--diff` `--config` `--exclude <glob>` `--disable <name>` `--json` `--color auto|always|never` `--debug` `-h/--help` `--version`.

Precedence: flags > `TYPESAFE_*` environment > `jint.config.ts` > defaults.

Output discipline: stdout carries only the report (stylish table, or `--json` machine shape `jint-report/v1`); logs are structured JSON on stderr, silent by default (`--debug` or `LOG_LEVEL` to enable). Color only on a TTY; `NO_COLOR`/`TERM=dumb`/`--color=never` suppress it, so piping is always clean.

A diff input decomposes into per-file units: added/modified files are measured, deleted and binary files are skipped, and the commit message (when available via git) is shared state for every unit.

## Exit codes

| code | meaning                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------- |
| 0    | clean (measurements, no error-severity signals)                                                       |
| 1    | error-severity signals found                                                                          |
| 2    | usage/config error (bad flags, `CONFIG_INVALID`, entrypoint not found/unreadable)                     |
| 3    | internal error                                                                                        |
| 4    | ran but failed — any per-unit diagnostic, or zero measurements (CI can never pass an unmeasured diff) |

## Errors

Operational failures are per-unit diagnostics in the stream (one unreadable file never kills a run): `JEV_AUTH`, `JEV_UNAVAILABLE`, `JEV_REQUEST_INVALID`, `JEV_RESPONSE_INVALID`. Throws are reserved for setup: `CONFIG_INVALID`, `ENTRYPOINT_NOT_FOUND`, `ENTRYPOINT_UNREADABLE`, and `INTERNAL` for invariant violations.

jev is called through `@typesafe-ai/sdk` (`client.systemOne({ state, questions })`, model `jev-latest`, one batched call per input). `TYPESAFE_API_KEY` is required; a missing or rejected key fails loud (`JEV_AUTH`) at the first call. `src/core/jev/client.ts` is the only file importing the SDK — the swappable backend seam (`lint()` accepts any `judge`).

## SDK

The CLI is one consumer; `lint()` is the product:

```ts
import { defineConfig, sensors, lint, collectReport } from "jint";

const report = await collectReport(
  lint({
    config: defineConfig({ input: "src/", sensors: { ...sensors.defaults, disable: [] } }),
    input: "src/a.ts", // optional override; inferred otherwise
    judge: mySwappableJudge, // optional; defaults to the jev adapter
  }),
);
// report: { measurements, signals, diagnostics }
```

`lint()` is an AsyncIterable of events (`measurement` / `signal` / `diagnostic`) — results stream as they are judged.

## Development

```bash
bun install
bun test            # 100+ tests incl. calibration checks against tmp/diff-v4
tsc --noEmit       # typecheck
bun src/cli.ts --help
```

State shapes: file/dir inputs judge `{ path, content }`; diff inputs judge `{ path, diff, commit_message }` — the calibrated tmp/diff-v4 shape, so the validated numbers transfer.
