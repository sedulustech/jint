<p align="center">
  <img src="logo.svg" width="220" alt="jint">
</p>

# jint, a semantic linter

`jint` classifies code with and turns the readings into actionable output via per-rule callbacks. Rules in, findings out.

## Install

```bash
curl -LO <release-url>/jint-darwin-arm64.tar.gz   # or -x64
tar -xzf jint-darwin-arm64.tar.gz && ./jint --help
export TYPESAFE_API_KEY=...                       # required; jev requests fail loud (JEV_AUTH) without it
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

## SDK

The CLI is only one type of client. `jint` ships an SDK where the entrypoint is `lint()`.

`classify()` is the measurement entrypoint for any string, any rules, no files and no config.

```ts
import { classify } from "jint";
const { measurements, errors, inventory } = await classify(str, rules, { path: "snippet.ts" });
```

Handlers are never applied here by the library.

Interpretation of raw values through configured thresholds is `lint()`'s responsibility.

## Development

```bash
bun install
bun test            # incl. calibration checks
bun run validate    # schema -> typecheck -> lint -> build
```

## Glossary

The canonical vocabulary to understand the codebase lives in [GLOSSARY.md](GLOSSARY.md).
It is the constraint the code and docs are held to, so it is maintained there rather than copied here.
