# Captures

A grammar's `queries.scm` turns a parsed file into **elements**. Each pattern assigns a
**capture** to a syntax node; the capture decides what the element is (`function`, `binding`,
`statement_group`, ...). Rules never see syntax: a rule names a **target**, and the target
resolves to the elements of one or more captures. Full target table: docs/targets.md.

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

- **Shared captures** (`function`, `method`, `class`, `type`, `binding`, `comment`, `import`): the
  cross-grammar vocabulary. A rule targets them by plural name (`functions`).
- **A grammar's own captures**: any name one grammar declares, for example
  `markdown:paragraph` or `typescript:statement_group`. A rule targets them by the qualified
  name `{grammar}:{capture}`.

## Add or change a capture

Capture behavior lives in the grammar, never in the engine. One pattern plus one directive makes
a new element:

```scheme
(program (for_statement) @statement_group
  (#set! "capture.statement_group.definition" "true"))
```

Other directives shape the element: whether it hides what is inside it (`opaque`), whether
adjacent nodes merge into one element (`merge`), whether same-capture nodes nest
(`selfNesting`). Every directive, with its values and the grammars that use it:
docs/directives.md (generated from the loader, so it is always the current list).

After the edit, run `jint capture` on a few files that contain the construct and a few that do
not. A new term needs a GLOSSARY.md entry the moment it is coined.

## Known gaps

Constructs with no capture yet are recorded per grammar in the `queries.scm` comments. Examples:
python's and php's top-level code (typescript's is `statement_group`), struct fields, code
blocks in markdown.
