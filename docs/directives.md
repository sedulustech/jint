---
title: Directives
description: Every #set! directive a grammar's queries.scm may declare.
sidebar:
  label: Directives
---

# Grammar directives

A directive rides a pattern in `queries.scm`: `(pattern) @capture (#set! "<name>" "<value>")`.
One name, one setting per file. A `capture.<name>.*` directive must ride a pattern that binds
`@<name>`. A directive not listed here fails at load. See [captures](captures.md).

<!-- generated:directives — do not edit. Regenerate with `bun run schema`. -->

| directive                    | values                         | what it does                                                                                                                                                   |
| ---------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selfNesting`                | (none)                         | Every capture's same-capture candidates nest (the grammar-wide form).                                                                                          |
| `attach.gap`                 | a whole number                 | A comment run attaches to the next definition across at most this many blank rows; 0 means the capture takes no attached run. Default 1.                       |
| `docstring.owner`            | next \| enclosing              | Who a docstring documents: the definition that follows it, or the one that contains it. Default enclosing.                                                     |
| `capture.<name>.definition`  | true \| false                  | The capture is an element rules can target. A grammar's own capture must declare it; shared captures are definitions by default.                               |
| `capture.<name>.opaque`      | true \| false                  | A different-capture candidate strictly inside is implementation and produces no element.                                                                       |
| `capture.<name>.selfNesting` | true \| false                  | Same-capture candidates nest: a nested one is an element of its own.                                                                                           |
| `capture.<name>.absorbTail`  | a whole number                 | The largest same-capture wrapper tail, in bytes, that still reads as one element (a trailing `;`).                                                             |
| `capture.<name>.merge`       | contiguous \| adjacent \| none | A run of same-capture nodes is one element. contiguous: a blank row or another element ends the run; adjacent: only another element ends it; none: no merging. |

<!-- /generated:directives -->
