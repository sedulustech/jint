# Grammars

Parsing is tree-sitter; nine grammars ship embedded with the binary. A grammar is a directory of
three artifacts: `<lang>.wasm` (parse), `<lang>.manifest.json` (facts: version, extensions,
optional policy), `queries.scm` (extraction patterns). The walker holds no node-type names — the
.scm assigns **captures**, and the runtime sees only captures. A user grammar dir
(`$JINT_GRAMMAR_DIR`, default `~/.jint/grammars`) registers through the same three-artifact shape - the supported home for
domain languages. One grammar per dir, artifacts flat: the three files sit directly in the dir,
no subdirs, one manifest + one queries.scm (a second manifest is a setup error - two would share
the one .scm). docs/byog.md is the contract plus a full verilog worked example.

| grammar id   | extensions                          | what it captures                                                                                                                                                                                                                                      |
| ------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript` | `.ts`, `.mts`, `.cts`               | functions, methods (`@method`), callable-initializer declarations; classes (`@class`), interfaces/type aliases/enums (`@type`); bindings; imports; comments; test call composites (`describe`/`it` family with a callback)                            |
| `tsx`        | `.tsx`                              | the typescript patterns (JSX stays inside the declarations)                                                                                                                                                                                           |
| `python`     | `.py`                               | functions, classes (`@class`), methods (`@method`, the structural-context capture: a `function_definition` in a class body), decorated definitions (decorator absorbed), imports, comments, docstrings (`@docstring`: the string-in-block convention) |
| `go`         | `.go`                               | functions, methods (`@method`, receiver functions), type declarations, package-level const/var blocks, imports, comments                                                                                                                              |
| `c`          | `.c`, `.h`                          | function definitions and prototypes, struct/union/enum/typedef, declarations, includes, comments                                                                                                                                                      |
| `cpp`        | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.h` | c's captures plus classes (`@class`, templates absorbed), methods (`@method`: in-class prototypes/definitions and out-of-line `K::f` definitions)                                                                                                     |
| `css`        | `.css`                              | comments only — the code captures have no honest css reading                                                                                                                                                                                          |
| `markdown`   | `.md`                               | sections (`@type`, heading text as name; sections nest)                                                                                                                                                                                               |
| `php`        | `.php`                              | functions (named + closures: `fn`/anonymous, an assigned closure keeping one element with the function noun), methods (`@method`), classes (`@class`)/interfaces/traits/enums, assignments, consts, imports, comments (anonymous classes unjudged)    |

`.h` is claimed by both c and cpp; registration order wins, so cpp serves it (design:
`grammar-loading` open question).

## Walk output (captures)

The walk turns one parsed file into its inventory. Each element carries a capture, a span, a
positional label (`d0`, `c2`, `i0`), an optional declared name (render-only), its parent label,
and its source. Captures:

| capture     | element                                                                                                            | target                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `function`  | named free functions, prototypes, and test call composites                                                         | `functions`                                                    |
| `method`    | member functions (ts/tsx `method_definition`, python class-body functions, go/php/cpp receivers and member shapes) | `methods`                                                      |
| `class`     | class-like units (ts/tsx/python/php/cpp class declarations)                                                        | `classes`                                                      |
| `type`      | interfaces, type aliases, enums, structs, modules, packages, typedefs, markdown sections                           | `types` (and the `definitions` umbrella)                       |
| `binding`   | a name bound to a non-callable, non-type value (declarations, assignments)                                         | `bindings` (and the `definitions` umbrella)                    |
| `import`    | import statements/declarations (one merged element per file)                                                       | `imports`                                                      |
| `comment`   | comments — standalone runs, attached leading runs, or interior comments (counted)                                  | `comments`                                                     |
| `docstring` | a grammar's docstring convention (python string-in-block); owned by its enclosing definition                       | `comments` (projected as a comment element with `docstringOf`) |

What a capture's interior yields is the per-capture policy table (`query.ts`), overridable per
grammar in its manifest. Targets are rule-side vocabulary: a rule names a target, the walk lands
it on elements. The `files` target skips the walk — the whole file is the judged subject.

Which constructs have no honest capture yet (prose, code blocks, struct fields) is recorded per grammar in `queries.scm` comments and in the design doc's
vocabulary-growth ledger.

## Walk contract

- **Dependency-driven.** A file is parsed only when an inventory-scoped rule in the resolved set
  targets elements in scope for it; files-target rules read raw source with no parse.
- **Sweep coverage.** Non-grammar files are units measured as raw source when a files-target rule
  is in scope; otherwise they are sweep coverage — one run-wide note, never an error:
  `parsing ts, tsx, py, …, css · not parsed (no grammar): .json, .sql`.
- **Explicit + unparseable is loud.** An explicit file path plus an element-target rule plus no
  grammar is a `MISSING_GRAMMAR` setup error naming the supported grammars (silence would read
  as "nothing wrong").
