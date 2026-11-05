---
title: BYOG — bring your own grammar
description: "Register any tree-sitter grammar, so rules can target the parts of any format: verilog, json, yaml, dart, html."
sidebar:
  label: BYOG
---

# BYOG — bring your own grammar

Tree-sitter has grammars for verilog, json, yaml, dart, html and almost any other format. Register
one, and a rule can target the exact part of that format it needs to judge: a domain team writes its
review questions as rules over the files only it understands.

Writing the queries is not hard with a coding agent. `jint capture` prints what a grammar captures,
with no classifier call, so the agent can check its work as it goes.

## The grammar directory

A grammar is one directory under `$JINT_GRAMMAR_DIR`, default `~/.jint/grammars`. The directory name
is the grammar id. It holds three files:

- `<id>.wasm` is the compiled grammar. Build it with `tree-sitter generate && tree-sitter build
--wasm`. Its export must be `tree_sitter_<id>`. Leave it out for an embedded id, such as `python`,
  and your `queries.scm` replaces the embedded one while the embedded parser is reused.
- `extensions.json` is a bare JSON array of dot-prefixed extensions, such as `[".v", ".sv"]`.
- `queries.scm` holds the patterns that assign [captures](captures.md) and the `#set!`
  [directives](directives.md).

## Captures

A pattern gives a syntax node a capture. Use a shared capture (`function`, `method`, `class`, `type`,
`binding`, `comment`, `import`) and the [targets](targets.md) and every shipped rule work on your
language unchanged. Anything else is your own capture, which needs one directive. See
[captures](captures.md).

```scheme
(module_declaration) @type
(always_construct) @function
(net_declaration) @binding
(comment) @comment
```

Check what it captures:

```bash
jint capture design.v
```

Every problem, such as a node type the grammar does not have, fails at setup and says what to fix.
