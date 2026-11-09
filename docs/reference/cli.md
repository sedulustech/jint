---
title: CLI reference
description: "Every verb and flag of the jint command, generated from the CLI."
sidebar:
  label: CLI
---

# CLI reference

Every verb and flag of the jint command, generated from the CLI.

<!-- generated:reference — do not edit. Regenerate with `bun run schema`. -->

## Verbs

The first operand is the verb. There is no default verb. The nouns and flags of a verb are indented under it.

### `run`

classify files and report the findings

```sh
jint run src/
```

#### `str`

piped stdin as one unit

```sh
cat snippet.ts | jint run str -
```

#### `paths`

a path list from piped stdin

```sh
git diff --name-only HEAD~1 | jint run paths -
```

#### `--language`

grammar for piped or extensionless input

_`<id>`_

```sh
jint run src/ --language python
```

#### `--config`

the config file to use

_`<path>`_

```sh
jint run src/ --config ci/jint.config.json
```

#### `--exclude`

skip inputs that match a glob (repeatable)

_`<glob>`_

```sh
jint run src/ --exclude "**/*.gen.ts"
```

#### `--disable`

turn a rule off (repeatable)

_`<name>`_

```sh
jint run src/ --disable is_short
```

#### `--rule`

run only these rules (repeatable)

_`<name>`_

```sh
jint run src/ --rule is_short
```

#### `--concurrency`

the most classifier calls in flight

_`<n>`_

```sh
jint run src/ --concurrency 8
```

#### `--timeout`

the time limit for one classifier call, in seconds

_`<secs>`_

```sh
jint run src/ --timeout 60
```

#### `--json`

print the report as JSON

```sh
jint run src/ --json
```

#### `--dry-run`

list the rules that would run, then exit

```sh
jint run src/ --dry-run
```

#### `--unscoped`

measure named files outside the config scope

```sh
jint run src/ --unscoped
```

#### `--no-cache`

ask every question, skip the answer cache

```sh
jint run src/ --no-cache
```

#### `--no-header`

hide the rules and scope header

```sh
jint run src/ --no-header
```

### `serve`

open the run UI on the newest run

```sh
jint serve
```

### `capture`

print what jint extracts from a file, without classifying

```sh
jint capture doc.md
```

#### `--config`

the config file to use

_`<path>`_

```sh
jint capture doc.md --config ci/jint.config.json
```

#### `--exclude`

skip inputs that match a glob (repeatable)

_`<glob>`_

```sh
jint capture doc.md --exclude "**/*.gen.ts"
```

#### `--rule`

mark the population of one rule

_`<name>`_

```sh
jint capture doc.md --rule is_short
```

#### `--queries`

extraction queries that replace the grammar's

_`<file.scm>`_

```sh
jint capture doc.md --queries my.scm
```

#### `--grammar`

a custom grammar for this call

_`<dir>`_

```sh
jint capture doc.md --grammar ./grammars/ini
```

#### `--json`

print the report as JSON

```sh
jint capture doc.md --json
```

### `reclassify`

classify one rule at one input of a recorded run again

```sh
jint reclassify <run-id> src/a.ts --rule <name> -
```

#### `--rule`

the rule to classify again

_`<name>`_

```sh
jint reclassify <run-id> src/a.ts --rule <name>
```

#### `--json`

print the report as JSON

```sh
jint reclassify <run-id> src/a.ts --rule <name> --json
```

### `skills`

write the agent skills that ship with jint to a directory

```sh
jint skills export .claude/skills
```

### `docs`

print a doc that ships with jint

```sh
jint docs config
```

## Flags for every verb

### `--help`

show this help

_`-h`_

```sh
jint --help
```

### `--version`

print the version

```sh
jint --version
```

### `--debug`

print structured debug logs

```sh
jint --debug
```

<!-- /generated:reference -->
