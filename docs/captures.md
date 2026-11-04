---
title: Captures
description: "How a grammar's queries.scm turns a parsed file into elements, and how a capture decides what an element is."
sidebar:
  label: Captures
---

# Captures

A grammar's `queries.scm` turns a parsed file into elements. Each pattern gives a syntax node a
capture, and the capture decides what the element is. A rule names a [target](targets.md), and the
target resolves to the elements of one or more captures.

## Check what a file yields

`jint capture` runs the extraction only. It makes no classifier calls, so it costs nothing.

```bash
jint capture src/cli.ts                    # one line per element: grammar, capture, span, name
jint capture src/cli.ts --json             # the element array as JSON
jint capture --rule is_cognitively_complex # mark the elements one rule will judge
jint capture src/a.ts --queries wip.scm    # extract with your own .scm instead of the grammar's
```

Run it before you calibrate a rule. A rule cannot find a defect in code that no element covers.

## Two kinds of capture

- **Shared captures** (`function`, `method`, `class`, `type`, `binding`, `comment`, `import`) form
  the vocabulary every grammar uses. A rule targets them by plural name, such as `functions`.
- **A grammar's own captures** belong to one grammar, such as `markdown:paragraph`. A rule targets
  them as `{grammar}:{capture}`.

## Add a capture

One pattern and one directive make a new element:

```scheme
(program (for_statement) @statement_group
  (#set! "capture.statement_group.definition" "true"))
```

Other directives shape the element: `opaque`, `merge` and `selfNesting`. See
[directives](directives.md).

Then run `jint capture` on files with the construct and files without it. A new term needs a
glossary entry when you coin it.

## Known gaps

Each grammar's `queries.scm` comments list the constructs with no capture yet. Examples are
top-level code in python and php, struct fields, and code blocks in markdown.
