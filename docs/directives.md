---
title: Directives
description: Every #set! directive a grammar's queries.scm may declare.
sidebar:
  label: Directives
---

# Grammar directives

A directive is a `#set!` line in a grammar's `queries.scm` that changes how a capture behaves.
Write it inside the pattern it applies to:

```scheme
(pattern) @capture (#set! "<name>" "<value>")
```

A `capture.<name>.*` directive must sit on a pattern that binds `@<name>`. Set each name once per
file. A directive not in the table fails at load. See [captures](captures.md).

<!-- generated:directives — do not edit. Regenerate with `bun run schema`. -->

| directive                    | values                         | what it does                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selfNesting`                | no value                       | Nested nodes of a capture become elements of their own, for every capture. The file-wide form of `capture.<name>.selfNesting`.                                                                                                        |
| `attach.gap`                 | a whole number                 | Rows a comment may end above a definition and still attach to it. 1 means directly above, 2 allows one blank row, 0 attaches nothing. Default 1.                                                                                      |
| `docstring.owner`            | next \| enclosing              | Which definition a docstring documents: `next` is the one after it, `enclosing` is the one around it. Default `enclosing`.                                                                                                            |
| `capture.<name>.definition`  | true \| false                  | Makes the capture an element a rule can target. Default true for function, method, class, type and binding; false for comment, import and docstring. A capture of your own must set this.                                             |
| `capture.<name>.opaque`      | true \| false                  | Hides every other capture inside this one, so they produce no elements. Default true for function, method and binding; false for the rest.                                                                                            |
| `capture.<name>.selfNesting` | true \| false                  | A node nested in another of the same capture becomes an element of its own. Default false.                                                                                                                                            |
| `capture.<name>.absorbTail`  | a whole number                 | Bytes a wrapper node may add after the capture, such as a final `;`, and still read as the same element. Default 2 for class, type and binding; otherwise 0.                                                                          |
| `capture.<name>.merge`       | contiguous \| adjacent \| none | Joins a run of same-capture nodes into one element. `contiguous` ends the run at a blank row or another element, `adjacent` ends it only at another element, `none` joins nothing. Default `none`; `import` defaults to `contiguous`. |

<!-- /generated:directives -->
