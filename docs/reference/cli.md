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

<h3 id="verb-run" class="field"><code>run</code><span class="pills"></span></h3>

classify files and report the findings

```sh
jint run src/
```

<h4 id="noun-str" class="field"><code>str</code><span class="pills"></span></h4>

piped stdin as one unit

```sh
cat snippet.ts | jint run str -
```

<h4 id="noun-paths" class="field"><code>paths</code><span class="pills"></span></h4>

a path list from piped stdin

```sh
git diff --name-only HEAD~1 | jint run paths -
```

<h4 id="flag-run-language" class="field"><code>--language</code><span class="pills"><span class="pill"><code>&lt;id&gt;</code></span></span></h4>

grammar for piped or extensionless input

```sh
jint run src/ --language python
```

<h4 id="flag-run-config" class="field"><code>--config</code><span class="pills"><span class="pill"><code>&lt;path&gt;</code></span></span></h4>

the config file to use

```sh
jint run src/ --config ci/jint.config.json
```

<h4 id="flag-run-exclude" class="field"><code>--exclude</code><span class="pills"><span class="pill"><code>&lt;glob&gt;</code></span></span></h4>

skip inputs that match a glob (repeatable)

```sh
jint run src/ --exclude "**/*.gen.ts"
```

<h4 id="flag-run-disable" class="field"><code>--disable</code><span class="pills"><span class="pill"><code>&lt;name&gt;</code></span></span></h4>

turn a rule off (repeatable)

```sh
jint run src/ --disable is_short
```

<h4 id="flag-run-rule" class="field"><code>--rule</code><span class="pills"><span class="pill"><code>&lt;name&gt;</code></span></span></h4>

run only these rules (repeatable)

```sh
jint run src/ --rule is_short
```

<h4 id="flag-run-concurrency" class="field"><code>--concurrency</code><span class="pills"><span class="pill"><code>&lt;n&gt;</code></span></span></h4>

the most classifier calls in flight

```sh
jint run src/ --concurrency 8
```

<h4 id="flag-run-timeout" class="field"><code>--timeout</code><span class="pills"><span class="pill"><code>&lt;secs&gt;</code></span></span></h4>

the time limit for one classifier call, in seconds

```sh
jint run src/ --timeout 60
```

<h4 id="flag-run-json" class="field"><code>--json</code><span class="pills"></span></h4>

print the report as JSON

```sh
jint run src/ --json
```

<h4 id="flag-run-dry-run" class="field"><code>--dry-run</code><span class="pills"></span></h4>

list the rules that would run, then exit

```sh
jint run src/ --dry-run
```

<h4 id="flag-run-unscoped" class="field"><code>--unscoped</code><span class="pills"></span></h4>

measure named files outside the config scope

```sh
jint run src/ --unscoped
```

<h4 id="flag-run-no-cache" class="field"><code>--no-cache</code><span class="pills"></span></h4>

ask every question, skip the answer cache

```sh
jint run src/ --no-cache
```

<h4 id="flag-run-no-header" class="field"><code>--no-header</code><span class="pills"></span></h4>

hide the rules and scope header

```sh
jint run src/ --no-header
```

<h3 id="verb-serve" class="field"><code>serve</code><span class="pills"></span></h3>

open the run UI on the newest run

```sh
jint serve
```

<h3 id="verb-capture" class="field"><code>capture</code><span class="pills"></span></h3>

print what jint extracts from a file, without classifying

```sh
jint capture doc.md
```

<h4 id="flag-capture-config" class="field"><code>--config</code><span class="pills"><span class="pill"><code>&lt;path&gt;</code></span></span></h4>

the config file to use

```sh
jint capture doc.md --config ci/jint.config.json
```

<h4 id="flag-capture-exclude" class="field"><code>--exclude</code><span class="pills"><span class="pill"><code>&lt;glob&gt;</code></span></span></h4>

skip inputs that match a glob (repeatable)

```sh
jint capture doc.md --exclude "**/*.gen.ts"
```

<h4 id="flag-capture-rule" class="field"><code>--rule</code><span class="pills"><span class="pill"><code>&lt;name&gt;</code></span></span></h4>

mark the population of one rule

```sh
jint capture doc.md --rule is_short
```

<h4 id="flag-capture-queries" class="field"><code>--queries</code><span class="pills"><span class="pill"><code>&lt;file.scm&gt;</code></span></span></h4>

extraction queries that replace the grammar's

```sh
jint capture doc.md --queries my.scm
```

<h4 id="flag-capture-grammar" class="field"><code>--grammar</code><span class="pills"><span class="pill"><code>&lt;dir&gt;</code></span></span></h4>

a custom grammar for this call

```sh
jint capture doc.md --grammar ./grammars/ini
```

<h4 id="flag-capture-json" class="field"><code>--json</code><span class="pills"></span></h4>

print the report as JSON

```sh
jint capture doc.md --json
```

<h3 id="verb-reclassify" class="field"><code>reclassify</code><span class="pills"></span></h3>

classify one rule at one input of a recorded run again

```sh
jint reclassify <run-id> src/a.ts --rule <name> -
```

<h4 id="flag-reclassify-rule" class="field"><code>--rule</code><span class="pills"><span class="pill"><code>&lt;name&gt;</code></span></span></h4>

the rule to classify again

```sh
jint reclassify <run-id> src/a.ts --rule <name>
```

<h4 id="flag-reclassify-json" class="field"><code>--json</code><span class="pills"></span></h4>

print the report as JSON

```sh
jint reclassify <run-id> src/a.ts --rule <name> --json
```

<h3 id="verb-skills" class="field"><code>skills</code><span class="pills"></span></h3>

write the agent skills that ship with jint to a directory

```sh
jint skills export .claude/skills
```

## Flags for every verb

<h3 id="flag-help" class="field"><code>--help</code><span class="pills"><span class="pill"><code>-h</code></span></span></h3>

show this help

```sh
jint --help
```

<h3 id="flag-version" class="field"><code>--version</code><span class="pills"></span></h3>

print the version

```sh
jint --version
```

<h3 id="flag-debug" class="field"><code>--debug</code><span class="pills"></span></h3>

print structured debug logs

```sh
jint --debug
```

<!-- /generated:reference -->
