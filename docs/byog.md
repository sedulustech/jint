---
title: BYOG — bring your own grammar
description: "The custom grammar seam: register any tree-sitter grammar, keep jint's capture vocabulary, and encode domain review questions as rules. Worked example: verilog."
sidebar:
  label: BYOG
---

# BYOG — bring your own grammar

The nine embedded grammars use the same shape as a grammar you add. Register any tree-sitter
grammar, and a domain team can write its review questions as rules over it.

## The contract

A grammar is one directory under `$JINT_GRAMMAR_DIR`, default `~/.jint/grammars`. The directory name
is the grammar id. It holds three files:

- `<id>.wasm` is the compiled grammar. Build it with `tree-sitter generate && tree-sitter build
--wasm`. Its export must be `tree_sitter_<id>`, and jint fails at load if the name disagrees with
  the directory. Without it, an embedded grammar of the same id is shadowed for extraction only.
- `extensions.json` is a bare JSON array of dot-prefixed extensions, such as `[".v", ".sv"]`.
- `queries.scm` holds the patterns that assign [captures](captures.md) and the `#set!`
  [directives](directives.md). A directive applies to the whole file: one name, one value.

A user grammar wins over an embedded grammar of the same language.

## Captures

The `.scm` is the interface. A capture your patterns emit is addressable as `<grammar>:<capture>`
once the `.scm` declares it. There are two tiers:

- **Shared captures** are `function`, `method`, `class`, `type`, `binding`, `comment`, `import` and
  `docstring`. Emit one with no declaration. It brings the whole vocabulary: the
  [targets](targets.md) and every shipped rule work on your language unchanged. Do not add a word
  to this tier for one grammar.
- **Your own captures** need one directive on one of their patterns:
  `(#set! "capture.<name>.definition" "true")`. Other `capture.<name>.*` directives set nesting,
  opacity and merging. Without them, a capture hides nothing and absorbs nothing.

`tests/capture-directives-e2e.test.ts` proves a new capture needs no engine edit.

## Validation

Every problem fails at setup, before jint measures a file, and the error says what to fix.

- A node type the grammar does not have.
- A capture that is neither shared nor declared.
- A directive that is malformed, unknown, or names a capture the `.scm` does not emit.
- Two patterns that give one root node type different captures. Pattern order is priority, so each
  pattern in the group needs a `; @priority` comment.
- An unbalanced `.scm`.
- A missing `extensions.json` or `queries.scm`, a malformed `extensions.json`, or a wasm that is
  invalid, exports no `tree_sitter_*` function, or disagrees with its directory.
- A rule address that names an unknown grammar or a capture the grammar does not emit.

## Worked example: verilog

Verilog has none of the usual programming-language primitives, so it tests the seam. The three
files came from tree-sitter-verilog 1.0.3. jint never fetches or builds grammars.

`extensions.json`:

```json
[".v", ".sv"]
```

`queries.scm`:

```scheme
; hardware units
(module_declaration (module_header (simple_identifier) @name)) @type
(module_declaration) @type

; behavior: an always block is the closest thing verilog has to a function with a body
(always_construct) @function
(initial_construct) @function
(final_construct) @function
(function_declaration (function_body_declaration (function_identifier) @name)) @function
(task_declaration (task_body_declaration (task_identifier) @name)) @function

; state
(net_declaration) @binding
(data_declaration) @binding
(continuous_assign) @binding

(comment) @comment
```

The authoring work is deciding which node types may speak as which capture without the capture
lying. Comments, defaults and targets are inherited.

### A rule

No conventional linter can ask whether a synthesis directive tells the truth. `parallel_case` asserts
that no two case arms match at once, Verilator honors it and never verifies it.

```json
[
  {
    "name": "is_case_directive_honest",
    "target": "functions",
    "include": ["**/*.v", "**/*.sv"],
    "instructions": "This unit is a Verilog procedural block containing a case statement marked with a synthesis directive comment (parallel_case and/or full_case). parallel_case asserts that no two case arms can match simultaneously. full_case asserts every possible selector value is covered. Judge whether the assertion is true of the visible selector and arm patterns. Answer true when a directive asserts something the selector and arms do not guarantee.",
    "criteria": {
      "true": "A directive whose claim the selector values and arm patterns do not guarantee.",
      "false": "No directive is present, or every directive's assertion holds."
    },
    "handle": { "warn": { "greater_than": 0.5 }, "error": { "greater_than": 0.7 } }
  }
]
```

On a fixture whose `case` matches two arms at once, the rule read 0.63. On a healthy fixture it read
0.17 at most. Both thresholds sit inside that gap. The reading is a review prompt for a human, so
the handle warns first.

Wording is the first knob. Name the exact shapes until healthy fixtures read clean. Move a
threshold last.

## Limits

- **Element size.** jint skips an element over 30,000 estimated tokens (120,000 characters). A
  3,994-line module measured. A 4,850-line module was skipped with a run note. Chunking is future
  work.
- **Extension collisions.** When two grammars claim an extension, registration order wins without an
  error.
