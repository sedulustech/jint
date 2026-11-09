---
title: Config reference
description: "Every config key and rule field, generated from the schema."
sidebar:
  label: Config
---

# Config reference

Every config key and rule field, generated from the schema.

<!-- generated:reference — do not edit. Regenerate with `bun run schema`. -->

## Run settings

<h3 id="input" class="field"><code>input</code><span class="pills"><span class="pill">string</span></span></h3>

The file or directory to measure. A path given to jint run overrides it.

<h3 id="secretdenylist" class="field"><code>secretDenylist</code><span class="pills"><span class="pill">string[]</span></span></h3>

Replaces the built-in denylist of secret-shaped files (gitignore patterns).

<h3 id="concurrency" class="field"><code>concurrency</code><span class="pills"><span class="pill">number</span><span class="pill">default 16</span></span></h3>

The most classifier calls in flight, run-wide, at most 64.

<h3 id="timeout" class="field"><code>timeout</code><span class="pills"><span class="pill">number</span><span class="pill">default 30</span></span></h3>

The time one classifier call may take, retries included, in seconds. Each attempt gets a third of it.

<h3 id="maxinputtokens" class="field"><code>maxInputTokens</code><span class="pills"><span class="pill">number</span></span></h3>

The most input tokens the model accepts in one call. A call over it is skipped with a note. Unset: elements over 30000 tokens are skipped.

<h3 id="charspertoken" class="field"><code>charsPerToken</code><span class="pills"><span class="pill">number</span><span class="pill">default 4</span></span></h3>

The characters of a request's JSON that count as one token, when sizing a call against maxInputTokens. Use a lower number for a model whose tokenizer splits code finely.

## Rule scope

<h3 id="rules-include" class="field"><code>rules.include</code><span class="pills"><span class="pill">string[]</span></span></h3>

The files jint reads, and the default scope of every rule.

<h3 id="rules-exclude" class="field"><code>rules.exclude</code><span class="pills"><span class="pill">string[]</span></span></h3>

The files jint skips. Exclude always wins over include.

## Rule fields

Each entry of `rules.use` is a rule name or a rule object with these fields.

<h3 id="name" class="field"><code>name</code><span class="pills"><span class="pill">string</span><span class="pill">required</span></span></h3>

The rule id: findings join back to it. Two entries with one name are a config error unless the later one sets override.

<h3 id="kind" class="field"><code>kind</code><span class="pills"><span class="pill">string</span></span></h3>

The question type. Absent means noul.

<h3 id="instructions" class="field"><code>instructions</code><span class="pills"><span class="pill">string</span><span class="pill">required</span></span></h3>

The yes/no question the model answers, specific to the rule's claim. Required - a generic fallback question would silently recalibrate every classification.

<h3 id="criteria" class="field"><code>criteria</code><span class="pills"><span class="pill">object</span><span class="pill">required</span></span></h3>

The two-sided contract: true names the exact observable condition for yes, false for no. The defect side decides the handle direction.

<h3 id="criteria-true" class="field"><code>criteria.true</code><span class="pills"><span class="pill">string</span><span class="pill">required</span></span></h3>

The condition for yes.

<h3 id="criteria-false" class="field"><code>criteria.false</code><span class="pills"><span class="pill">string</span><span class="pill">required</span></span></h3>

The condition for no.

<h3 id="target" class="field"><code>target</code><span class="pills"><span class="pill">string | object</span><span class="pill">required</span></span></h3>

What the rule measures: files, a kind of element, or a capture. A list measures each.

<h3 id="handle" class="field"><code>handle</code><span class="pills"><span class="pill">string | object</span><span class="pill">required</span></span></h3>

How a reading becomes a finding. The shape follows the kind of the rule.

<h3 id="handle-map" class="field"><code>handle.map</code><span class="pills"><span class="pill">object[]</span><span class="pill">required</span></span></h3>

One tier for each score level, in the order of the criteria.

<h3 id="handle-map-level" class="field"><code>handle.map.level</code><span class="pills"><span class="pill">string | object</span><span class="pill">required</span></span></h3>

The severity of a finding: pass raises none.

<h3 id="handle-map-message" class="field"><code>handle.map.message</code><span class="pills"><span class="pill">string</span></span></h3>

The rule author's feedback; the finding's note when this tier fires.

<h3 id="handle-choices" class="field"><code>handle.choices</code><span class="pills"><span class="pill">object</span><span class="pill">required</span></span></h3>

One tier for each option, keyed by the option label.

<h3 id="handle-undecided" class="field"><code>handle.undecided</code><span class="pills"><span class="pill">object</span></span></h3>

The tier of a reading with no clear winner among the options.

<h3 id="handle-undecided-margin" class="field"><code>handle.undecided.margin</code><span class="pills"><span class="pill">number</span><span class="pill">required</span></span></h3>

The gap between the two likeliest options under which the reading is undecided.

<h3 id="handle-undecided-level" class="field"><code>handle.undecided.level</code><span class="pills"><span class="pill">string | object</span><span class="pill">required</span></span></h3>

The severity of a finding: pass raises none.

<h3 id="handle-undecided-message" class="field"><code>handle.undecided.message</code><span class="pills"><span class="pill">string</span></span></h3>

The note on the finding of an undecided reading.

<h3 id="handle-warn" class="field"><code>handle.warn</code><span class="pills"><span class="pill">string | object</span></span></h3>

One threshold comparison: exactly one operator. The operator IS the defect direction - greater_than fires on high readings, less_than on low ones. Within (0, 1).

<h3 id="handle-warn-greater_than" class="field"><code>handle.warn.greater_than</code><span class="pills"><span class="pill">number</span><span class="pill">required</span></span></h3>

The threshold. A reading above it fires.

<h3 id="handle-warn-message" class="field"><code>handle.warn.message</code><span class="pills"><span class="pill">string</span></span></h3>

The rule author's feedback; the finding's note when this tier fires.

<h3 id="handle-warn-less_than" class="field"><code>handle.warn.less_than</code><span class="pills"><span class="pill">number</span><span class="pill">required</span></span></h3>

The threshold. A reading below it fires.

<h3 id="handle-error" class="field"><code>handle.error</code><span class="pills"><span class="pill">string | object</span></span></h3>

One threshold comparison: exactly one operator. The operator IS the defect direction - greater_than fires on high readings, less_than on low ones. Within (0, 1).

<h3 id="handle-error-greater_than" class="field"><code>handle.error.greater_than</code><span class="pills"><span class="pill">number</span><span class="pill">required</span></span></h3>

The threshold. A reading above it fires.

<h3 id="handle-error-message" class="field"><code>handle.error.message</code><span class="pills"><span class="pill">string</span></span></h3>

The rule author's feedback; the finding's note when this tier fires.

<h3 id="handle-error-less_than" class="field"><code>handle.error.less_than</code><span class="pills"><span class="pill">number</span><span class="pill">required</span></span></h3>

The threshold. A reading below it fires.

<h3 id="handle-silent_band" class="field"><code>handle.silent_band</code><span class="pills"><span class="pill">object[]</span></span></h3>

A [low, high] range of readings that raises no finding.

<h3 id="include" class="field"><code>include</code><span class="pills"><span class="pill">string[]</span></span></h3>

Globs of the files this rule reads. It replaces the run include for this rule.

<h3 id="exclude" class="field"><code>exclude</code><span class="pills"><span class="pill">string[]</span></span></h3>

Globs of the files this rule skips. Exclude always wins over include.

<h3 id="includepath" class="field"><code>includePath</code><span class="pills"><span class="pill">boolean</span></span></h3>

true: the model is handed the file's path with the source. Default false: only the source is sent, so the same code reads the same wherever the file sits. Set it for a rule whose claim is about the path itself.

<h3 id="override" class="field"><code>override</code><span class="pills"><span class="pill">boolean</span></span></h3>

true: this entry replaces an earlier entry of the same name. Without it a repeated name is a config error, and with it an entry that replaces nothing is too.

<!-- /generated:reference -->
