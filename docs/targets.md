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

## Cross-language targets

<!-- generated:targets — do not edit. Regenerate with `bun run schema`. -->

| target           | resolves to                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `files`          | the whole unit as source text (no walk)                                                                                                  |
| `functions`      | elements captured as functions                                                                                                           |
| `classes`        | elements captured as classes (the @class capture: class-like units)                                                                      |
| `methods`        | elements captured as methods (the @method capture: member functions)                                                                     |
| `types`          | elements captured as types (interfaces, structs, enums, aliases)                                                                         |
| `bindings`       | elements captured as bindings (a name bound to a value)                                                                                  |
| `definitions`    | elements captured as functions, classes, methods, types or bindings (a shorthand: prefer the specific targets in new rules)              |
| `comments`       | elements captured as comments, plus the definition each one belongs to (the comments above it, inside it, and its docstring)             |
| `loose-comments` | elements captured as standalone comments, with no definition they belong to: runs of comments and inline comments outside any definition |
| `imports`        | elements captured as imports: one merged import group per file                                                                           |

<!-- /generated:targets -->

## Language-specific targets

A custom capture that belongs to one grammar can be a target of its own, written `{grammar}:{capture}`. The embedded grammars ship a few, such as `markdown:table` and `bash:statement_group`.

- A new capture in a grammar's `queries.scm` becomes the target `{grammar}:{capture}`. The `; extends` example in [captures](captures.md#add-a-capture) adds `python:statement_group` this way.
- A capture named for a shared word, such as `@function`, joins the default target `functions` for that grammar. No `{grammar}:` target exists for it.
- A grammar you bring ([BYOG](byog.md)) gets default targets for the shared words it captures and `{grammar}:` targets for the rest.
- Run `jint capture --rule <name>` to see which elements a rule's target resolves to.
