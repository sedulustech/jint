---
title: Configuration
description: "One config file per run: every key, in its JSON and TypeScript forms."
sidebar:
  label: Config
---

# Configuration

A run reads one config file, either in `.json` or `.ts` form.

`jint.config.ts` has precedence. `--config` overrides discovery. A run with no config fails.

<!-- generated:config — do not edit. Regenerate with `bun run schema`. -->

```ts
import { defineConfig } from "jint:sdk";

export default defineConfig({
  // The file or directory to measure. A path given to jint run overrides it.
  input: "src/",
  // The rules to run, and the files they read.
  rules: {
    // The files jint reads, and the default scope of every rule.
    include: ["**/*.ts"],
    // The files jint skips. Exclude always wins over include.
    exclude: ["**/*.test.ts"],
    // The rules to run: names from a rule domain, or full rule objects.
    use: ["is_greppable", "is_function_srp"],
  },
  // Replaces the built-in denylist of secret-shaped files (gitignore patterns).
  secretDenylist: ["!.env.example"],
  // The most classifier calls in flight, run-wide, at most 64.
  concurrency: 16,
  // The time one classifier call may take, retries included, in seconds. Each attempt
  // gets a third of it.
  timeout: 30,
  // The most input tokens the model accepts in one call. A call over it is skipped with a
  // note. Unset: elements over 30000 tokens are skipped.
  maxInputTokens: 4096,
  // The characters of a request's JSON that count as one token, when sizing a call
  // against maxInputTokens. Use a lower number for a model whose tokenizer splits code
  // finely.
  charsPerToken: 2,
});
```

<!-- /generated:config -->

## Run settings

These keys are not rules. They set what a run reads and how it asks.

<!-- generated:run-settings — do not edit. Regenerate with `bun run schema`. -->

| Key              | Type        | Meaning                                                                                                                                                                              |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `input`          | string      | The file or directory to measure. A path given to jint run overrides it.                                                                                                             |
| `secretDenylist` | string list | Replaces the built-in denylist of secret-shaped files (gitignore patterns).                                                                                                          |
| `concurrency`    | number      | The most classifier calls in flight, run-wide, at most 64. Default 16.                                                                                                               |
| `timeout`        | number      | The time one classifier call may take, retries included, in seconds. Each attempt gets a third of it. Default 30.                                                                    |
| `maxInputTokens` | number      | The most input tokens the model accepts in one call. A call over it is skipped with a note. Unset: elements over 30000 tokens are skipped.                                           |
| `charsPerToken`  | number      | The characters of a request's JSON that count as one token, when sizing a call against maxInputTokens. Use a lower number for a model whose tokenizer splits code finely. Default 4. |

<!-- /generated:run-settings -->

The `rules` key holds `include`, `exclude` and `use`. These keys are rule settings. See
[what are rules](what-are-rules.md).

## Rule fields

Each entry of `rules.use` is a rule name or a rule object with these fields.

<!-- generated:rule-fields — do not edit. Regenerate with `bun run schema`. -->

| Field                       | Type           | Meaning                                                                                                                                                                                                            |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                      | string         | The rule id: findings join back to it. Two entries with one name are a config error unless the later one sets override.                                                                                            |
| `kind`                      | string         | The question type. Absent means noul.                                                                                                                                                                              |
| `instructions`              | string         | The yes/no question the model answers, specific to the rule's claim. Required - a generic fallback question would silently recalibrate every classification.                                                       |
| `criteria`                  | object         | The two-sided contract: true names the exact observable condition for yes, false for no. The defect side decides the handle direction.                                                                             |
| `criteria.true`             | string         | The condition for yes.                                                                                                                                                                                             |
| `criteria.false`            | string         | The condition for no.                                                                                                                                                                                              |
| `target`                    | one of several | What the rule measures: files, a kind of element, or a capture. A list measures each.                                                                                                                              |
| `handle`                    | one of several | How a reading becomes a finding. The shape follows the kind of the rule.                                                                                                                                           |
| `handle.map`                | list           | One tier for each score level, in the order of the criteria.                                                                                                                                                       |
| `handle.map.level`          | one of several | The severity of a finding: pass raises none.                                                                                                                                                                       |
| `handle.map.message`        | string         | The rule author's feedback; the finding's note when this tier fires.                                                                                                                                               |
| `handle.choices`            | object         | One tier for each option, keyed by the option label.                                                                                                                                                               |
| `handle.undecided`          | object         | The tier of a reading with no clear winner among the options.                                                                                                                                                      |
| `handle.undecided.margin`   | number         | The gap between the two likeliest options under which the reading is undecided.                                                                                                                                    |
| `handle.undecided.level`    | one of several | The severity of a finding: pass raises none.                                                                                                                                                                       |
| `handle.undecided.message`  | string         | The note on the finding of an undecided reading.                                                                                                                                                                   |
| `handle.warn`               | one of several | One threshold comparison: exactly one operator. The operator IS the defect direction - greater_than fires on high readings, less_than on low ones. Within (0, 1).                                                  |
| `handle.warn.greater_than`  | number         | The threshold. A reading above it fires.                                                                                                                                                                           |
| `handle.warn.message`       | string         | The rule author's feedback; the finding's note when this tier fires.                                                                                                                                               |
| `handle.warn.less_than`     | number         | The threshold. A reading below it fires.                                                                                                                                                                           |
| `handle.error`              | one of several | One threshold comparison: exactly one operator. The operator IS the defect direction - greater_than fires on high readings, less_than on low ones. Within (0, 1).                                                  |
| `handle.error.greater_than` | number         | The threshold. A reading above it fires.                                                                                                                                                                           |
| `handle.error.message`      | string         | The rule author's feedback; the finding's note when this tier fires.                                                                                                                                               |
| `handle.error.less_than`    | number         | The threshold. A reading below it fires.                                                                                                                                                                           |
| `handle.silent_band`        | list           | A [low, high] range of readings that raises no finding.                                                                                                                                                            |
| `include`                   | string list    | Globs of the files this rule reads. It replaces the run include for this rule.                                                                                                                                     |
| `exclude`                   | string list    | Globs of the files this rule skips. Exclude always wins over include.                                                                                                                                              |
| `includePath`               | boolean        | true: the model is handed the file's path with the source. Default false: only the source is sent, so the same code reads the same wherever the file sits. Set it for a rule whose claim is about the path itself. |
| `override`                  | boolean        | true: this entry replaces an earlier entry of the same name. Without it a repeated name is a config error, and with it an entry that replaces nothing is too.                                                      |

<!-- /generated:rule-fields -->

### Input window

`maxInputTokens` is the most input tokens the model accepts in one call. Set it to the model limit,
not to the server context size. Jint estimates each call as the element plus the questions of the
rules that apply to it. It skips a call over `maxInputTokens`, and names the element in a note.

Jint has no tokenizer. It counts one token for every `charsPerToken` characters of the request
JSON. The default is 4. A model that splits code finely needs a lower number. Measure it: send a
few real calls and divide the request characters by the input tokens the server reports. We
measured about 2 for `Laya-GGUF`. A wrong number makes jint send calls the server refuses, or skip
calls that fit.

```json
{
  "maxInputTokens": 4096,
  "charsPerToken": 2
}
```

`charsPerToken` has no effect without `maxInputTokens`. Without `maxInputTokens`, jint skips each
element over 30000 tokens and sends the rest.

### Concurrency and timeout

A flag overrides the config key, and the config key overrides the default. The flags are
`--concurrency` and `--timeout`.

The endpoint sets the right values. A fast API accepts the defaults. A server that answers one
request at a time, such as a local model on a CPU, needs `concurrency` of 1. A slow server also
needs a longer `timeout`.

An attempt gets one third of `timeout`. The default of 30 seconds gives each attempt 10 seconds and
allows two retries. A `timeout` of 120 gives each attempt 40 seconds.

```json
{
  "concurrency": 1,
  "timeout": 120
}
```

## Environment variables

Environment variables name the endpoint and the places jint keeps files. A config file holds none
of them, because a team commits its config.

| Variable           | Default                      | Meaning                                                                                  |
| ------------------ | ---------------------------- | ---------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`   | none                         | The key for `api.openai.com`. jint sends it nowhere else.                                |
| `JINT_API_URL`     | OpenAI's Decisions API       | The endpoint. Its last segment names the wire. See [models and endpoints](endpoints.md). |
| `JINT_API_KEY`     | none                         | The key for the url in `JINT_API_URL`. It wins over `OPENAI_API_KEY`.                    |
| `JINT_API_MODEL`   | `gpt-6-luna` on `/decisions` | The model to ask. A `/v1/systemone` server needs it, except TypeSafe's own host.         |
| `JINT_RUNS_DIR`    | `~/.jint/runs`               | The directory where jint records runs.                                                   |
| `JINT_CACHE_DIR`   | `~/.jint/cache`              | The directory of the answer cache.                                                       |
| `JINT_GRAMMAR_DIR` | `~/.jint/grammars`           | The directory of custom grammars.                                                        |
| `JINT_UI_HOST`     | `127.0.0.1`                  | The host that `jint ui serve` binds. Give a host, not `host:port`.                       |
| `JINT_UI_PORT`     | a free port                  | The port that `jint ui serve` binds.                                                     |
| `JINT_LOG_LEVEL`   | `off`                        | The log level on stderr: `debug`, `info`, `warn`, `error` or `off`.                      |

An empty variable counts as unset.

## `jint.config.json`

The declarative tier is plain data. Nothing in it executes. We ship a JSON schema for editor
autocomplete.

## `jint.config.ts`

The imperative configuration is a TypeScript module that default-exports `defineConfig({ ... })` from
`"jint:sdk"`. It takes the same keys as the JSON tier.

jint rejects bare npm specifiers and `node:*` builtins in the config file before it runs. This
fence keeps the config portable. It is not a sandbox, because a relative helper can import anything
the runtime offers.
