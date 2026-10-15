# Grammars

Parsing is tree-sitter; ten grammars ship embedded with the binary. A grammar is a directory of
three artifacts: `<lang>.wasm` (parse), `<lang>.manifest.json` (facts: version, extensions,
optional policy), `queries.scm` (extraction patterns). The walker holds no node-type names — the
.scm assigns **captures**, and the runtime sees only captures. A user grammar dir
(`$JINT_DIR/grammars`) registers through the same three-artifact shape.

| grammar id   | extensions                          | what it captures                                                                                                                                                                         |
| ------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript` | `.ts`, `.mts`, `.cts`               | functions, methods, callable-initializer declarations; classes/interfaces/type aliases/enums; bindings; imports; comments; test call composites (`describe`/`it` family with a callback) |
| `tsx`        | `.tsx`                              | the typescript patterns (JSX stays inside the declarations)                                                                                                                              |
| `python`     | `.py`                               | functions, classes, decorated definitions (decorator absorbed), imports, comments, docstrings (`@docstring`: the string-in-block convention)                                             |
| `go`         | `.go`                               | functions and methods, type declarations, package-level const/var blocks, imports, comments                                                                                              |
| `c`          | `.c`, `.h`                          | function definitions and prototypes, struct/union/enum/typedef, declarations, includes, comments                                                                                         |
| `cpp`        | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.h` | c's captures plus classes, methods, member-function prototypes, template declarations (absorbed)                                                                                         |
| `css`        | `.css`                              | comments only — the code captures have no honest css reading                                                                                                                             |
| `markdown`   | `.md`                               | sections (`@type`, heading text as name; sections nest)                                                                                                                                  |
| `php`        | `.php`                              | functions, methods, classes/interfaces/traits/enums, assignments, consts, imports, comments                                                                                              |
| `verilog`    | `.v`, `.sv`                         | modules, always/initial constructs, nets/assigns, comments                                                                                                                               |

`.h` is claimed by both c and cpp; registration order wins, so cpp serves it (design:
`grammar-loading` open question).

## Walk output (captures)

The walk turns one parsed file into its inventory. Each element carries a capture, a span, a
positional label (`d0`, `c2`, `i0`), an optional declared name (render-only), its parent label,
and its source. Captures:

| capture     | element                                                                                      | target                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `function`  | named functions, methods, prototypes, and test call composites                               | `functions`                                                                              |
| `type`      | classes, interfaces, type aliases, enums, structs, modules, markdown sections                | `definitions`                                                                            |
| `binding`   | a name bound to a non-callable, non-type value (declarations, nets, assigns, assignments)    | `definitions` (definitions-target rules judge bindings; functions-target rules never do) |
| `import`    | import statements/declarations (one merged element per file)                                 | `imports`                                                                                |
| `comment`   | comments — standalone runs, attached leading runs, or interior comments (counted)            | `comments`                                                                               |
| `docstring` | a grammar's docstring convention (python string-in-block); owned by its enclosing definition | `comments` (projected as a comment element with `docstringOf`)                           |

What a capture's interior yields is the per-capture policy table (`query.ts`), overridable per
grammar in its manifest. Targets are rule-side vocabulary: a rule names a target, the walk lands
it on elements. The `files` target skips the walk — the whole file is the judged subject.

Which constructs have no honest capture yet (prose, code blocks, struct fields, verilog
instantiations) is recorded per grammar in `queries.scm` comments and in the design doc's
vocabulary-growth ledger.

## Walk contract

- **Dependency-driven.** A file is parsed only when an inventory-scoped rule in the resolved set
  targets elements in scope for it; files-target rules read raw source with no parse.
- **Sweep coverage.** Non-grammar files are units measured as raw source when a files-target rule
  is in scope; otherwise they are sweep coverage — one run-wide note, never an error:
  `parsing v, sv, ts, …, css · not parsed (no grammar): .json, .sql`.
- **Explicit + unparseable is loud.** An explicit file path plus an element-target rule plus no
  grammar is a `MISSING_GRAMMAR` setup error naming the supported grammars (silence would read
  as "nothing wrong").
