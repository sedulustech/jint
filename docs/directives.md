---
title: Directives
description: Every #set! directive a grammar's queries.scm may declare, generated from the loader's vocabulary.
---

# Grammar directives

GENERATED — do not edit. Regenerate with `bun run schema` (scripts/generate-schema.ts). The rows
come from the directive vocabulary the loader validates against
(`packages/sdk/src/core/grammars/query.ts`); a directive not listed here fails at load.

A directive rides a pattern in `queries.scm`: `(pattern) @capture (#set! "<name>" "<value>")`.
One name, one setting per file. A `capture.<name>.*` directive must ride a pattern that binds
`@<name>`. How captures become elements, and how to check them: docs/captures.md.

| directive                    | values                         | what it does                                                                                                                                                   | declared in                                                                                                    |
| ---------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `selfNesting`                | (none)                         | Every capture's same-capture candidates nest (the grammar-wide form).                                                                                          | —                                                                                                              |
| `attach.gap`                 | a whole number                 | A comment run attaches to the next definition across at most this many blank rows; 0 means the capture takes no attached run. Default 1.                       | —                                                                                                              |
| `docstring.owner`            | next \| enclosing              | Who a docstring documents: the definition that follows it, or the one that contains it. Default enclosing.                                                     | —                                                                                                              |
| `capture.<name>.definition`  | true \| false                  | The capture is an element rules can target. A grammar's own capture must declare it; shared captures are definitions by default.                               | typescript (statement_group), tsx (statement_group), markdown (section, list_item, list, paragraph)            |
| `capture.<name>.opaque`      | true \| false                  | A different-capture candidate strictly inside is implementation and produces no element.                                                                       | typescript (statement_group), tsx (statement_group)                                                            |
| `capture.<name>.selfNesting` | true \| false                  | Same-capture candidates nest: a nested one is an element of its own.                                                                                           | markdown (section, list)                                                                                       |
| `capture.<name>.absorbTail`  | a whole number                 | The largest same-capture wrapper tail, in bytes, that still reads as one element (a trailing `;`).                                                             | —                                                                                                              |
| `capture.<name>.merge`       | contiguous \| adjacent \| none | A run of same-capture nodes is one element. contiguous: a blank row or another element ends the run; adjacent: only another element ends it; none: no merging. | typescript (import, statement_group), tsx (import, statement_group), python (import), cpp (import), c (import) |
