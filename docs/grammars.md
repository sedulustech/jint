# Grammars

Parsing is tree-sitter; nine grammars ship embedded with the binary. A grammar is a directory
NAMED for its id (nextjs-route semantics: the directory IS the grammar id, cross-checked at load
against the wasm's own `tree_sitter_<name>` export) holding three artifacts: `<id>.wasm` (parse),
`extensions.json` (routing: a bare JSON array like `[".md"]`), `queries.scm`
(extraction patterns + shape directives). The walker holds no node-type names - the .scm assigns
**captures**, and the runtime sees only captures. A user grammar dir
(`$JINT_GRAMMAR_DIR`, default `~/.jint/grammars`) registers through the same shape - each
SUBDIRECTORY is one grammar, its id the directory name. docs/byog.md is the contract plus a full
verilog worked example.

| grammar id   | extensions                          | what it captures                                                                                                                                                                                                                                      |
| ------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript` | `.ts`, `.mts`, `.cts`               | functions, methods (`@method`), callable-initializer declarations; classes (`@class`), interfaces/type aliases/enums (`@type`); bindings; imports; comments; test call composites (`describe`/`it` family with a callback)                            |
| `tsx`        | `.tsx`                              | the typescript patterns (JSX stays inside the declarations)                                                                                                                                                                                           |
| `python`     | `.py`                               | functions, classes (`@class`), methods (`@method`, the structural-context capture: a `function_definition` in a class body), decorated definitions (decorator absorbed), imports, comments, docstrings (`@docstring`: the string-in-block convention) |
| `go`         | `.go`                               | functions, methods (`@method`, receiver functions), type declarations, package-level const/var blocks, imports, comments                                                                                                                              |
| `c`          | `.c`, `.h`                          | function definitions and prototypes, struct/union/enum/typedef, declarations, includes, comments                                                                                                                                                      |
| `cpp`        | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.h` | c's captures plus classes (`@class`, templates absorbed), methods (`@method`: in-class prototypes/definitions and out-of-line `K::f` definitions)                                                                                                     |
| `css`        | `.css`                              | comments only — the code captures have no honest css reading                                                                                                                                                                                          |
| `markdown`   | `.md`                               | sections (`@section`, self-nesting per the .scm's #set! directive, addressed as `markdown:section`; heading text as name) and paragraphs (`@paragraph`, flat - paragraphs never nest; addressed as `markdown:paragraph`)                              |
| `php`        | `.php`                              | functions (named + closures: `fn`/anonymous, an assigned closure keeping one element with the function capture), methods (`@method`), classes (`@class`)/interfaces/traits/enums, assignments, consts, imports, comments (anonymous classes unjudged) |

`.h` is claimed by both c and cpp; registration order wins, so cpp serves it (design:
`grammar-loading` open question).

## Walk output (captures)

The walk turns one parsed file into its inventory. Each element carries a capture, a span, a
positional label (`d0`, `c2`, `i0`), an optional declared name (render-only), its parent label,
and its source. Captures:

| capture     | element                                                                                                                                 | target                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `function`  | named free functions, prototypes, and test call composites                                                                              | `functions`                                                    |
| `method`    | member functions (ts/tsx `method_definition`, python class-body functions, go/php/cpp receivers and member shapes)                      | `methods`                                                      |
| `class`     | class-like units (ts/tsx/python/php/cpp class declarations)                                                                             | `classes`                                                      |
| `type`      | interfaces, type aliases, enums, structs, modules, packages, typedefs                                                                   | `types` (and the `definitions` umbrella)                       |
| `binding`   | a name bound to a non-callable, non-type value (declarations, assignments)                                                              | `bindings` (and the `definitions` umbrella)                    |
| `import`    | import statements/declarations (one merged element per contiguous run)                                                                  | `imports`                                                      |
| `comment`   | comments — standalone runs, attached leading runs, or interior comments (counted)                                                       | `comments`                                                     |
| `docstring` | python's docstring convention - PLUMBING, not a shared capture (projects into the comment element; grammar-side vocabulary, like @name) | `comments` (projected as a comment element with `docstringOf`) |

What a capture's interior yields is declared in the grammar's .scm: shared captures carry the
defaults in `grammars/shared.ts`, and every change is a #set! directive (docs/directives.md;
docs/captures.md for how to check the result with `jint capture`). Targets are rule-side vocabulary: a rule names a target, the walk lands
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
