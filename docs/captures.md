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

One pattern and one directive make a new element. This one captures the top-level loops and
conditionals of a Python script, which no shipped capture covers:

```scheme
; extends
(module
  [(for_statement) (while_statement) (if_statement)] @statement_group
  (#set! "capture.statement_group.definition" "true")
  (#set! "capture.statement_group.merge" "adjacent")) ; @priority
```

The first line, `; extends`, adds the file to the grammar's own `queries.scm`. Without it, the file
replaces the grammar's queries whole. Your patterns come first, and the earlier pattern wins when two
match one node, so a pattern of yours can also override a capture of the grammar's. A directive you
set replaces the same directive in the grammar's file.

`; @priority` says the pattern order is deliberate. A pattern needs it when another pattern in your
file shares its root node type.

To try it, run:

```bash
jint capture main.py --queries extra.scm
```

To use it in a run, save it as `queries.scm` in `$JINT_GRAMMAR_DIR/python/`, by default
`~/.jint/grammars/python/`, next to an `extensions.json` such as `[".py"]`. The embedded grammar's
parser is reused. A rule targets the new capture as `python:statement_group`. See [BYOG](byog.md).

Other directives shape the element: `opaque`, `merge` and `selfNesting`. See
[directives](directives.md).

Then run `jint capture` on files with the construct and files without it.
