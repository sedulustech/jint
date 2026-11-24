---
title: Config reference
description: "Every config key and rule field, generated from the schema."
sidebar:
  label: Config
---

# Config reference

Every config key and rule field, generated from the schema.

<!-- generated:reference — do not edit. Regenerate with `bun run schema:generate`. -->

## Run settings

### `input`

The file or directory to measure. A path given to jint run overrides it.

_string_

### `secretDenylist`

Replaces the built-in denylist of secret-shaped files (gitignore patterns).

_string[]_

### `concurrency`

The most classifier calls in flight, run-wide, at most 64.

_number · default 16_

### `timeout`

The time one classifier call may take, retries included, in seconds. Each attempt gets a third of it.

_number · default 30_

### `maxInputTokens`

The most input tokens the model accepts in one call. A call over it is skipped with a note. Unset: elements over 30000 tokens are skipped.

_number_

### `charsPerToken`

The characters of a request's JSON that count as one token, when sizing a call against maxInputTokens. Use a lower number for a model whose tokenizer splits code finely.

_number · default 4_

## Rule scope

### `rules.include`

The files jint reads, and the default scope of every rule.

_string[]_

### `rules.exclude`

The files jint skips. Exclude always wins over include.

_string[]_

## Rule fields

Each entry of `rules.use` is a rule name or a rule object with these fields.

### `name`

The rule id: findings join back to it. Two entries with one name are a config error unless the later one sets override.

_string · required_

### `kind`

The question type. Absent means noul.

_string_

### `instructions`

The yes/no question the model answers, specific to the rule's claim. Required - a generic fallback question would silently recalibrate every classification.

_string · required_

### `criteria`

The two-sided contract: true names the exact observable condition for yes, false for no. The defect side decides the handle direction.

_object · required_

### `criteria.true`

The condition for yes.

_string · required_

### `criteria.false`

The condition for no.

_string · required_

### `target`

What the rule measures: files, a kind of element, or a capture. A list measures each.

_string | object · required_

### `handle`

How a value becomes a finding. The shape follows the kind of the rule.

_string | object · required_

### `include`

Globs of the files this rule reads. It replaces the run include for this rule.

_string[]_

### `exclude`

Globs of the files this rule skips. Exclude always wins over include.

_string[]_

### `includePath`

true: the model is handed the file's path with the source. Default false: only the source is sent, so the same code reads the same wherever the file sits. Set it for a rule whose claim is about the path itself.

_boolean_

### `override`

true: this entry replaces an earlier entry of the same name. Without it a repeated name is a config error, and with it an entry that replaces nothing is too.

_boolean_

## Rule handler fields

The `handle` of a rule turns its answer into a severity. The fields it takes depend on the rule kind.

### `map`

One tier for each score level, in the order of the criteria.

_object[] · required_

### `map.level`

The severity of a finding: pass raises none.

_string | object · required_

### `map.message`

The rule author's feedback; the finding's note when this tier fires.

_string_

### `choices`

One tier for each option, keyed by the option label.

_object · required_

### `undecided`

The tier of a value with no clear winner among the options.

_object_

### `undecided.margin`

The gap between the two likeliest options under which the value is undecided.

_number · required_

### `undecided.level`

The severity of a finding: pass raises none.

_string | object · required_

### `undecided.message`

The note on the finding of an undecided value.

_string_

### `warn`

One threshold comparison: exactly one operator. The operator IS the defect direction - greater_than fires on high values, less_than on low ones. Within (0, 1).

_string | object_

### `warn.greater_than`

The threshold. A value above it fires.

_number · required_

### `warn.message`

The rule author's feedback; the finding's note when this tier fires.

_string_

### `warn.less_than`

The threshold. A value below it fires.

_number · required_

### `error`

One threshold comparison: exactly one operator. The operator IS the defect direction - greater_than fires on high values, less_than on low ones. Within (0, 1).

_string | object_

### `error.greater_than`

The threshold. A value above it fires.

_number · required_

### `error.message`

The rule author's feedback; the finding's note when this tier fires.

_string_

### `error.less_than`

The threshold. A value below it fires.

_number · required_

### `silent_band`

A [low, high] range of values that raises no finding.

_object[]_

## Rule function fields

Functions, so they work only in `jint.config.ts`. A JSON config cannot compose a state yet: one with a `state` or `classify` field is an error.

### `state`

Composes what the model reads about one element. Each key is a part, and a part with no value is left out. It replaces the element's own source, and a function that throws fails that element only.

_(target) => object_

### `classify`

Composes the question too, when it changes from one element to the next. A rule has state or classify, never both.

_(target) => { instructions, criteria, state }_

### `target`

Chooses the elements to judge. It is given every element of the run.

_(elements) => elements_

### `handle`

Decides the severity of each result, after every element is classified. A null severity raises no finding.

_(results, ctx) => decisions_

## Element fields

The `self` a function is given: one captured element.

### `name`

The declared name, or the heading's text. Absent when the capture has none.

_string_

### `key`

The key of a pair, which has one in place of a name.

_string_

### `value`

What the element holds under its name or key.

_string_

### `source`

The element's text, less what its grammar omits from the capture.

_string_

### `parent`

The element this one sits inside.

_element | null_

### `file`

The file the element is in. A file's own is itself.

_file_

### `getElement`

The one element directly inside this one that a selector matches. It throws when there is none, or more than one.

_(target, name?) => element_

### `getElements`

The elements directly inside this one that a selector matches, or all of them, in file order.

_(target?) => element[]_

### `capture`

What the element is, as its grammar captures it.

_string_

### `grammar`

The grammar that captured the element.

_string_

### `path`

The file the element is in.

_string_

### `span`

Where the element is in the file: lines, columns and bytes.

_object_

### `signature`

A definition's text up to its body, or its first line.

_string_

### `attachedComment`

The comment run directly above a definition.

_string[]_

### `docstrings`

The docstrings a definition owns outside its own text.

_string[]_

### `docstringOf`

For a docstring: the definition it documents.

_object_

### `internalCommentCount`

How many comments sit inside the element.

_number_

### `docstringCount`

How many docstrings the definition owns.

_number_

### `id`

The element's identity in this run.

_string_

### `label`

The element's position in its file, such as d0.

_string_

## Context fields

The `ctx` of `handle`.

### `targets`

Every element the rule judges in this run.

_element[]_

## File fields

The `file` of an element, and what a `files` target judges. It has the fields of an element, and these.

### `path`

The file's path.

_string_

### `source`

The file's whole text.

_string_

### `getElement`

The one element at the top of the file that a selector matches. It throws when there is none, or more than one.

_(target, name?) => element_

### `getElements`

The elements at the top of the file that a selector matches, or all of them, in file order.

_(target?) => element[]_

### `definitions`

The file's definitions, at any depth.

_element[]_

### `comments`

The file's comments, at any depth.

_element[]_

### `imports`

The file's imports.

_element[]_

<!-- /generated:reference -->
