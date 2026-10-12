<p align="center">
  <img src="logo.svg" width="160" alt="jint">
</p>

# jint, a semantic linter

`jint` classifies code with and turns the readings into actionable output via per-rule callbacks. Rules in, findings out.

## Install

npm (the `rc` dist-tag tracks prereleases; plain `@sedulus/jint` resolves `latest`, empty until the first stable release):

```bash
npm install -g @sedulus/jint@rc   # or a devDependency
npx @sedulus/jint@rc --version
```

The package is a meta-package: it pulls the matching platform binary (`@sedulus/jint-linux-x64`, `-linux-arm64`, `-darwin-x64`, `-darwin-arm64`) via optionalDependencies and exposes the `jint` bin. Works with npm and bun (`bunx`).

Shell installer (installs to `~/.local/bin`, verifies sha256 against the release `checksums.txt`, warns if `~/.local/bin` is not on `PATH`):

```bash
curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/main/install.sh | bash
VERSION=v1.2.3 curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/main/install.sh | bash   # pin a version
```

To build from source, see [Development](#development).

```bash
export TYPESAFE_API_KEY=...   # required; jev requests fail loud (JEV_AUTH) without it
```

## How to use

```bash
jint src/                                # a directory tree
jint src/a.ts src/b.ts                   # explicit files
cat snippet.ts | jint str -              # piped stdin, one str unit (the only str form)
jint paths - < list.txt                  # a path LIST from a file, piped
git diff --name-only HEAD~1 | jint paths -   # a path LIST from your git pipeline
jint                                     # no positional: input comes from jint.config.json
```

`jint` uses the default configuration unless a specific config is passed to it through the `--config` flag.

```json
{
  "$schema": "./node_modules/jint/jint.schema.json",
  "input": "src/",
  "rules":, [],
  "exclude": []
}
```

Every run records its requests to `~/.jint/runs/` (`JEV_DIR` moves it; recording is
always on), and `bun run ui` opens the measurement ui on the same store — the last lint run is immediately browsable.

Re-declare a default rule by name and give it new criteria, thresholds, or both:

```json
{
  "input": "src/",
  "rules": [
    {
      "name": "is_name_purposeful",
      "criteria": {
        "true": "Every identifier's name in this code states what it does or holds: a reader can infer the thing's purpose from the name alone, without reading the surrounding code. Casing and convention style are not part of this judgment.",
        "false": "At least one name reveals implementation instead of purpose (naming how it works, not what it is for), is a bare generic word that could label anything (data, handler, util, temp), or misleads by promising behavior or a kind the thing does not have."
      },
      "target": "definitions",
      "handle": { "warn": { "less_than": 0.4 }, "error": { "less_than": 0.3 } }
    }
  ]
}
```

Add a full rule object to write a new one. `target` names what the rule judges, as one value or a list:

| target        | what it judges                                        |
| ------------- | ----------------------------------------------------- |
| `files`       | the whole file as one unit                            |
| `functions`   | each function or method                               |
| `definitions` | every declaration except comments and imports         |
| `comments`    | each comment, including one attached to a declaration |
| `imports`     | the file's imports as one merged unit                 |

Omitting `target` on an override keeps the default rule's own target.

**Exit codes:** `0` clean · `1` error-severity findings · `2` usage/config error · `3` internal · `4` ran but classified nothing

### No runtime needed

The binary ships with virtual modules and the Bun runtime: writing rules does not require a JS runtime. an npm
install, or `node_modules`.

```ts
import { defaultRules } from "jint:defaults";

export default { rules: [...defaultRules] };
```

## Default rules

The rules shipped as default were calibrated and dogfooded against jint's own `src/` and other repositories.

Treat them as a starting point and tune once you know what your code looks like.

| rule                              | what it judges                                                |
| --------------------------------- | ------------------------------------------------------------- |
| `is_name_purposeful`              | names that state purpose, not implementation or bare generics |
| `is_vocabulary_consistent`        | one concept keeping one name                                  |
| `is_naming_convention_consistent` | one casing convention per kind                                |
| `is_greppable`                    | names that grep to one concept                                |
| `is_filename_fitting`             | a file name matching the responsibility its body carries      |
| `is_comment_narration`            | comments restating what the code says                         |
| `is_comment_patching_readability` | comments compensating for code that should read itself        |
| `will_comment_drift`              | comments pinning artifacts by name                            |
| `will_error_lose_cause`           | error handling that drops the original failure                |
| `is_cognitively_complex`          | structural difficulty that re-reading cannot remove           |
| `is_function_srp`                 | one function, one cohesive responsibility                     |

## Development

```bash
bun install
bun test            # incl. calibration checks
bun run validate    # schema -> typecheck -> lint -> build
```

### Testing

Recording is always on — every jint run is an inspectable artifact, and there is no off switch.
Tests live in the same store world, so they redirect instead of disable:

- `bunfig.toml` preloads `test-preload.ts`, which sets `JEV_DIR` to a pid-scoped scratch store
  (`tests/helpers/cli.ts` exports it as `RUNS_DIR`). In-process classifiers record there, never
  into `~/.jint/runs`.
- **Caveat:** bun captures the environment at process startup, so the preload's `JEV_DIR` does
  NOT reach spawned processes. Any test that runs the CLI must go through
  `tests/helpers/cli.ts` (`runCli` / `runCliSync` / `runShell`), which passes `JEV_DIR`
  explicitly. Spawning the CLI bare bypasses the redirect — one test did exactly that and the
  real store filled with fixture runs.
- One store per test process: `RUNS_DIR` is pid-scoped, so parallel workers never write into the
  same run directory.

## Glossary

The canonical vocabulary to understand the codebase lives in [GLOSSARY.md](GLOSSARY.md).
It is the constraint the code and docs are held to, so it is maintained there rather than copied here.
