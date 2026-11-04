---
title: Grammars
description: "The tree-sitter grammars embedded in the binary and the three files a grammar directory holds."
sidebar:
  label: Grammars
---

# Grammars

jint uses [tree-sitter](https://tree-sitter.github.io/tree-sitter/index.html) to parse your code and embeds nine grammars in the binary.

A grammar is a directory named for its id. It holds three files:

- `<id>.wasm` parses the language. Its `tree_sitter_<id>` export must match the directory name.
- `extensions.json` routes files to the grammar. It is a bare JSON array, such as `[".md"]`.
- `queries.scm` holds the extraction patterns and the shape directives.

The walker knows no node types. The `.scm` assigns [captures](captures.md), and the rest of jint
sees only captures.

Your own grammars live in `$JINT_GRAMMAR_DIR`, default `~/.jint/grammars`. Each subdirectory is one
grammar. See [Bring your own grammar](byog.md).

## Embedded grammars

| grammar      | extensions                          |
| ------------ | ----------------------------------- |
| `typescript` | `.ts`, `.mts`, `.cts`               |
| `tsx`        | `.tsx`                              |
| `python`     | `.py`                               |
| `go`         | `.go`                               |
| `c`          | `.c`, `.h`                          |
| `cpp`        | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.h` |
| `css`        | `.css`                              |
| `markdown`   | `.md`                               |
| `php`        | `.php`                              |

Both `c` and `cpp` claim `.h`. Registration order decides, and `cpp` serves it.

`css` captures comments only, because the code captures have no honest reading of css.

## Walk

The walk turns one parsed file into elements. Each element carries a capture, a span, a positional
label (`d0`, `c2`, `i0`), an optional name, its parent label and its source.

- **Parsing is demand-driven.** jint parses a file only when a rule targets elements in it. A
  `files` rule reads the raw source and skips the parse.
- **Unparsed files are a note.** Without a grammar, a file is measured as raw source by a `files`
  rule. Otherwise the run notes it once, for example `not parsed (no grammar): .json, .sql`.
- **A named file with no grammar is an error.** An explicit path, an element-target rule and no
  grammar give a `MISSING_GRAMMAR` setup error that names the supported grammars.
