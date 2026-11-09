---
title: Config reference
description: "Every config key and rule field, generated from the schema."
sidebar:
  label: Config
---

# Config reference

Every config key and rule field, generated from the schema.

<!-- generated:reference — do not edit. Regenerate with `bun run schema`. -->

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
  // The most classifier calls in flight, run-wide. Default 16, max 64.
  concurrency: 16,
  // The time one classifier call may take, retries included, in seconds. Default 30. Each
  // attempt gets a third of it.
  timeout: 30,
  // The most input tokens the model accepts in one call. A call over it is skipped with a
  // note. Unset: elements over 30000 tokens are skipped.
  maxInputTokens: 4096,
  // The characters of a request's JSON that count as one token, when sizing a call
  // against maxInputTokens. Default 4. Use a lower number for a model whose tokenizer
  // splits code finely.
  charsPerToken: 2,
});
```

## Run settings

| Key              | Type        | Meaning                                                                                                                                                                              |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `input`          | string      | The file or directory to measure. A path given to jint run overrides it.                                                                                                             |
| `secretDenylist` | string list | Replaces the built-in denylist of secret-shaped files (gitignore patterns).                                                                                                          |
| `concurrency`    | number      | The most classifier calls in flight, run-wide. Default 16, max 64.                                                                                                                   |
| `timeout`        | number      | The time one classifier call may take, retries included, in seconds. Default 30. Each attempt gets a third of it.                                                                    |
| `maxInputTokens` | number      | The most input tokens the model accepts in one call. A call over it is skipped with a note. Unset: elements over 30000 tokens are skipped.                                           |
| `charsPerToken`  | number      | The characters of a request's JSON that count as one token, when sizing a call against maxInputTokens. Default 4. Use a lower number for a model whose tokenizer splits code finely. |

## Rule fields

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

<!-- /generated:reference -->
