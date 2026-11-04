---
title: Targets
description: The targets a rule can name, and what each one resolves to.
sidebar:
  label: Targets
---

# Targets

Rules need to specify what types of text they should target. We ship a few by default, but jint is
extensible, so you can bring your own [grammar](grammars.md) and [capture](captures.md) your own
code snippets.

<!-- generated:targets — do not edit. Regenerate with `bun run schema`. -->

| target           | resolves to                                                                                                                                                                                                                                                                                                       | grammars emitting it                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `files`          | the whole unit as source text (no walk)                                                                                                                                                                                                                                                                           | every format (no grammar needed)              |
| `functions`      | elements captured as functions                                                                                                                                                                                                                                                                                    | typescript, tsx, python, php, go, cpp, c      |
| `classes`        | elements captured as classes (the @class capture: class-like units)                                                                                                                                                                                                                                               | typescript, tsx, python, php, cpp             |
| `methods`        | elements captured as methods (the @method capture: member functions)                                                                                                                                                                                                                                              | typescript, tsx, python, php, go, cpp         |
| `types`          | elements captured as types (interfaces, structs, enums, aliases)                                                                                                                                                                                                                                                  | typescript, tsx, php, go, cpp, c              |
| `bindings`       | elements captured as bindings (a name bound to a value)                                                                                                                                                                                                                                                           | typescript, tsx, php, go, cpp, c              |
| `definitions`    | SHORTHAND for every definition capture at once (functions, classes, methods, types, bindings) - the same measured set; prefer the specific targets in new rules                                                                                                                                                   | typescript, tsx, python, php, go, cpp, c      |
| `comments`       | the DOCUMENTATION pair frame: a definition judged together with the comments it owns (attached run, internal notes, docstrings); a module docstring, which has no definition frame, is its own match. An owned comment element never matches separately, so a narration rule fires once per documented definition | typescript, tsx, python, php, go, cpp, c, css |
| `loose-comments` | comment elements NO definition owns: standalone runs and inline comments outside any definition (the complement of comments)                                                                                                                                                                                      | typescript, tsx, python, php, go, cpp, c, css |
| `imports`        | the one merged import-group element per file                                                                                                                                                                                                                                                                      | typescript, tsx, python, php, go, cpp, c      |

<!-- /generated:targets -->
