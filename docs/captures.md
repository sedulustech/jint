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
(module
  [(for_statement) (while_statement) (if_statement)] @statement_group
  (#set! "capture.statement_group.definition" "true")
  (#set! "capture.statement_group.merge" "adjacent")) ; @priority
```

`; @priority` says the pattern order is deliberate. A pattern needs it when another pattern shares
its root node type, as Python's docstring pattern shares `module`.

To try it, add the pattern to a copy of the grammar's own `queries.scm`, which lives in the repo
under `packages/sdk/src/core/grammars/embedded/<id>/`, and run it:

```bash
jint capture main.py --queries extra.scm
```

To use it in a run, put the grammar where jint looks for grammars: `$JINT_GRAMMAR_DIR/python/`,
by default `~/.jint/grammars/python/`. It holds the grammar's `python.wasm`, its `extensions.json`
and the edited `queries.scm`. A user grammar wins over the embedded one of the same id, and a rule
targets the new capture as `python:statement_group`. See [BYOG](byog.md).

Other directives shape the element: `opaque`, `merge` and `selfNesting`. See
[directives](directives.md).

Then run `jint capture` on files with the construct and files without it.
