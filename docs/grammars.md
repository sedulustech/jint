# Grammars

Parsing is tree-sitter; grammars ship embedded with the binary. Adding a language = adding its
prebuilt grammar wasm + one role-table entry; the walker is written against roles, never node names.

| grammar id   | extensions            | role table highlights                                                                                                                                                                                                                                                             |
| ------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript` | `.ts`, `.mts`, `.cts` | function declarations, methods, lexical/variable declarations (refined: callable initializer -> function, otherwise binding), classes/interfaces/type aliases/enums -> type, comments, imports; `describe(...)`-style call expressions are composites (judged AND descended into) |
| `tsx`        | `.tsx`                | shares the typescript table (JSX stays inside the declarations)                                                                                                                                                                                                                   |
| `python`     | `.py`                 | functions, classes, comments, imports; docstrings are extracted structurally (`docstringOf`) so every docstring element carries its owner                                                                                                                                         |
| `go`         | `.go`                 | functions and methods, `type_declaration` -> type, package-level const/var blocks -> binding, comments, imports                                                                                                                                                                   |

## Walk output (roles)

The walk turns one parsed file into its inventory. Each element carries a role, a span, a
positional label (`d0`, `c2`, `i0`), an optional declared name (render-only), its parent label,
and its source. Roles:

| role       | element                                                                                                                                    | target                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `function` | named functions, methods, call-expression composites; declarations refined to keep the function role only when the bound value is callable | `functions`                                                                              |
| `type`     | classes, interfaces, type aliases, enums, Go type declarations                                                                             | `definitions`                                                                            |
| `binding`  | a name bound to a non-callable, non-type value                                                                                             | `definitions` (definitions-target rules judge bindings; functions-target rules never do) |
| `import`   | import statements/declarations                                                                                                             | `imports`                                                                                |
| `comment`  | comments — top-level runs, docstrings, or comments inside a composite's descent                                                            | `comments`                                                                               |

Targets are rule-side vocabulary: a rule names a target, the walk lands it on elements. The
`files` target skips the walk — the whole file (unit) is the judged subject.

## Walk contract

- **Dependency-driven.** A file is parsed only when an inventory-scoped rule in the resolved set
  targets elements in scope for it; files-target rules read raw source with no parse.
- **Sweep coverage.** Non-grammar files are units measured as raw source when a files-target rule
  is in scope; otherwise they are sweep coverage — one run-wide note, never an error:
  `parsing ts, tsx, py, go · not parsed (no grammar): .md, .sql`.
- **Explicit + unparseable is loud.** An explicit file path plus an element-target rule plus no
  grammar is a `MISSING_GRAMMAR` setup error naming the supported grammars (silence would read
  as "nothing wrong").
