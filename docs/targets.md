---
title: Targets
description: The targets a rule can name, and what each one resolves to.
sidebar:
  label: Targets
---

# Targets

Rules need to specify what types of text they should target. We ship a few by default, but jint is
extensible, so you can bring your own [grammar](grammars.md) and [capture](captures.md) your own
elements.

<!-- generated:targets — do not edit. Regenerate with `bun run schema`. -->

| target           | resolves to                                                                                                                                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files`          | the whole unit as source text (no walk)                                                                                                                                                                                                                                                                           |
| `functions`      | elements captured as functions                                                                                                                                                                                                                                                                                    |
| `classes`        | elements captured as classes (the @class capture: class-like units)                                                                                                                                                                                                                                               |
| `methods`        | elements captured as methods (the @method capture: member functions)                                                                                                                                                                                                                                              |
| `types`          | elements captured as types (interfaces, structs, enums, aliases)                                                                                                                                                                                                                                                  |
| `bindings`       | elements captured as bindings (a name bound to a value)                                                                                                                                                                                                                                                           |
| `definitions`    | SHORTHAND for every definition capture at once (functions, classes, methods, types, bindings) - the same measured set; prefer the specific targets in new rules                                                                                                                                                   |
| `comments`       | the DOCUMENTATION pair frame: a definition judged together with the comments it owns (attached run, internal notes, docstrings); a module docstring, which has no definition frame, is its own match. An owned comment element never matches separately, so a narration rule fires once per documented definition |
| `loose-comments` | comment elements NO definition owns: standalone runs and inline comments outside any definition (the complement of comments)                                                                                                                                                                                      |
| `imports`        | the one merged import-group element per file                                                                                                                                                                                                                                                                      |

<!-- /generated:targets -->
