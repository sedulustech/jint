---
title: Targets
description: The rule-side target table, generated from the live resolution and the grammars' patterns.
---

# Rule targets

GENERATED — do not edit. Regenerate with `bun run schema` (scripts/generate-schema.ts). The rows
come from the target vocabulary (`@jint/contract`), the resolution predicate
(`packages/sdk/src/core/rules/classify.ts`), and each grammar's own `queries.scm` census — a
rule resolves what this table says or the generator fails.

The three rule-target namespaces are FILE / NODE TYPE / CAPTURE (`docs/designs/grammar-loading.md`).
The table below covers the CAPTURE namespace's fixed targets; the NODE TYPE lane is its own
section.

| target           | namespace | singular                    | resolves to                                                                                                                                                                                                                                                                                                       | grammars emitting it                          | frame carried                                                       | scope-coupled |
| ---------------- | --------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------- | ------------- |
| `files`          | FILE      | file                        | the whole unit as source text (no walk)                                                                                                                                                                                                                                                                           | every format (no grammar needed)              | the unit's raw content under its path                               | yes           |
| `functions`      | CAPTURE   | function                    | elements captured as functions                                                                                                                                                                                                                                                                                    | typescript, tsx, python, php, go, cpp, c      | attached run + inline comments + code (the pair frame)              | yes           |
| `classes`        | CAPTURE   | class                       | elements captured as classes (the @class capture: class-like units)                                                                                                                                                                                                                                               | typescript, tsx, python, php, cpp             | attached run + inline comments + code (the pair frame)              | yes           |
| `methods`        | CAPTURE   | method                      | elements captured as methods (the @method capture: member functions)                                                                                                                                                                                                                                              | typescript, tsx, python, php, go, cpp         | attached run + inline comments + code (the pair frame)              | yes           |
| `types`          | CAPTURE   | type                        | elements captured as types (interfaces, structs, enums, aliases, sections)                                                                                                                                                                                                                                        | typescript, tsx, php, go, cpp, c              | attached run + inline comments + code (the pair frame)              | yes           |
| `bindings`       | CAPTURE   | binding                     | elements captured as bindings (a name bound to a value)                                                                                                                                                                                                                                                           | typescript, tsx, php, go, cpp, c              | attached run + inline comments + code (the pair frame)              | yes           |
| `definitions`    | CAPTURE   | definition (umbrella)       | SHORTHAND for every definition capture at once (functions, classes, methods, types, bindings) - the same measured set; prefer the specific targets in new rules                                                                                                                                                   | typescript, tsx, python, php, go, cpp, c      | attached run + inline comments + code (the pair frame)              | yes           |
| `comments`       | CAPTURE   | definition (the pair frame) | the DOCUMENTATION pair frame: a definition judged together with the comments it owns (attached run, internal notes, docstrings); a module docstring, which has no definition frame, is its own match. An owned comment element never matches separately, so a narration rule fires once per documented definition | typescript, tsx, python, php, go, cpp, c, css | attached run + inline comments + docstrings + code (the pair frame) | yes           |
| `loose-comments` | CAPTURE   | comment (element)           | comment elements NO definition owns: standalone runs and inline comments outside any definition (the complement of comments)                                                                                                                                                                                      | typescript, tsx, python, php, go, cpp, c, css | the comment's own text under its path                               | yes           |
| `imports`        | CAPTURE   | import (element)            | the one merged import-group element per file                                                                                                                                                                                                                                                                      | typescript, tsx, python, php, go, cpp, c      | the merged import statements                                        | yes           |

## The `lang:node_type` lane

A rule may target one grammar's raw tree-sitter node type directly (`target: "typescript:class_declaration"`)
for the format-specific tail. Node types are grammar-local (no shared meaning across grammars),
so they are never a fixed row in the table above — they are read from the grammar at load and
resolve like any other target. Use the CAPTURE targets for rules that must run across grammars;
use this lane only when the rule is honestly about that one format.

Registered grammars: typescript (.ts, .mts, .cts); tsx (.tsx); python (.py); markdown (.md); php (.php); go (.go); cpp (.cpp, .cc, .cxx, .hpp, .h); c (.c, .h); css (.css).
