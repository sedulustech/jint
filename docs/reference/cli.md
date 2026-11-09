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

The first operand is the verb. There is no default verb. The pill is an example.

<h3 id="verb-run" class="field"><code>run</code><span class="pills"><span class="pill"><code>jint run src/</code></span></span></h3>

classify an input: paths, the str/paths stdin nouns, or the discovered config; needs OPENAI_API_KEY (or JINT_API_URL, with JINT_API_KEY unless the server is local) in the environment

<h3 id="verb-serve" class="field"><code>serve</code><span class="pills"><span class="pill"><code>jint serve</code></span></span></h3>

the run UI over the store's newest run - hold, Ctrl+C to exit; binds loopback only (override: JINT_UI_HOST - a non-loopback host is your trust decision, a port in it is rejected); honors JINT_UI_PORT

<h3 id="verb-capture" class="field"><code>capture</code><span class="pills"><span class="pill"><code>jint capture doc.md</code></span></span></h3>

print extraction - grammar, kind, span, name - with the classifier unplugged; loads the config like run (its input when no target, its rules.exclude always); an explicit FILE target bypasses the config's rules scope (a dir target never does) - capture prints structure, no classifier, while run's file operand evaluates the config scope for unscoped rules

<h3 id="verb-reclassify" class="field"><code>reclassify</code><span class="pills"><span class="pill"><code>jint reclassify &lt;run-id&gt; src/a.ts --rule &lt;name&gt; -</code></span></span></h3>

classify one rule at one input of a recorded run again and file it under that run as its next #N, where the run UI shows it at once; with a trailing - a JSON edit ({instructions, criteria, code}, only what changed) is read from stdin, without it the original question is asked again; needs the endpoint key like run

<h3 id="verb-skills" class="field"><code>skills</code><span class="pills"><span class="pill"><code>jint skills export .claude/skills</code></span></span></h3>

write the agent skills that ship with jint (jint-follow, jint-author, jint-propose) into a directory, one folder per skill, replacing files that exist

## Flags

A flag with a verb pill applies to that verb only. A flag with no verb pill applies to every verb. An
argument pill shows the value the flag takes, and a second code pill is its short alias.

<h3 id="flag-language" class="field"><code>--language</code><span class="pills"><span class="pill"><code>&lt;id&gt;</code></span></span></h3>

tree-sitter grammar for piped-stdin/extensionless sources; valid ids: typescript, tsx, python, markdown, php, go, cpp, c, bash, css, json, toml, yaml (derived from the grammar map). Without a resolvable language, inventory-scoped rules fail WALK_FAILED in-band and unit-scoped rules still classify

<h3 id="flag-config" class="field"><code>--config</code><span class="pills"><span class="pill"><code>&lt;path&gt;</code></span></span></h3>

config file (auto-discovered: jint.config.ts or jint.config.json; JSON autocomplete via the "$schema" key)

<h3 id="flag-exclude" class="field"><code>--exclude</code><span class="pills"><span class="pill"><code>&lt;glob&gt;</code></span></span></h3>

input exclusion, on top of config (repeatable)

<h3 id="flag-disable" class="field"><code>--disable</code><span class="pills"><span class="pill"><code>&lt;name&gt;</code></span></span></h3>

rule removal by name, on top of config (repeatable)

<h3 id="flag-rule" class="field"><code>--rule</code><span class="pills"><span class="pill"><code>&lt;name&gt;</code></span></span></h3>

run: ONLY these rules (repeatable; overrides --disable). capture: ONE name - preview the population it will judge, marked with * (nothing is classified). reclassify: ONE name - the rule to reclassify (required)

<h3 id="flag-concurrency" class="field"><code>--concurrency</code><span class="pills"><span class="pill"><code>&lt;n&gt;</code></span></span></h3>

max in-flight classifier calls, run-wide (default 16, max 64; overrides the config key of the same name)

<h3 id="flag-timeout" class="field"><code>--timeout</code><span class="pills"><span class="pill"><code>&lt;secs&gt;</code></span></span></h3>

per-call classifier timeout in seconds, retries included (default 30; each attempt gets a third of it; a hung call becomes a per-element PROVIDER_TIMEOUT failure)

<h3 id="flag-queries" class="field"><code>--queries</code><span class="pills"><span class="pill"><code>&lt;file.scm&gt;</code></span><span class="pill">capture</span></span></h3>

capture only: the .scm file that drives extraction, replacing the grammar's own queries.scm

<h3 id="flag-grammar" class="field"><code>--grammar</code><span class="pills"><span class="pill"><code>&lt;dir&gt;</code></span><span class="pill">capture</span></span></h3>

capture only: a grammar dir (<id>.wasm + extensions.json [+ queries.scm]) registered custom for this call

<h3 id="flag-json" class="field"><code>--json</code><span class="pills"></span></h3>

machine report (byte-identical to the run's report.json) instead of raw finding lines

<h3 id="flag-dry-run" class="field"><code>--dry-run</code><span class="pills"></span></h3>

print the rule set that WOULD run (config resolved, disable/only applied) and exit 0 - zero input walks, zero classifier calls

<h3 id="flag-unscoped" class="field"><code>--unscoped</code><span class="pills"><span class="pill">run</span></span></h3>

run: measure named files and a path list as given - the config's rules scope (rules.include/exclude) is not applied; a rule's own include/exclude still is

<h3 id="flag-no-cache" class="field"><code>--no-cache</code><span class="pills"><span class="pill">run</span></span></h3>

run: ask every question instead of serving stored answers (the answer cache is $JINT_CACHE_DIR, else ~/.jint/cache)

<h3 id="flag-no-header" class="field"><code>--no-header</code><span class="pills"><span class="pill">run</span></span></h3>

run: do not print the rules and scope header on stderr (the rules stay in the report's rules)

<h3 id="flag-debug" class="field"><code>--debug</code><span class="pills"></span></h3>

structured debug logs on stderr

<h3 id="flag-help" class="field"><code>--help</code><span class="pills"><span class="pill"><code>-h</code></span></span></h3>

this help

<h3 id="flag-version" class="field"><code>--version</code><span class="pills"></span></h3>

print the version

<!-- /generated:reference -->
