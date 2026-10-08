# Use cases

Every form exists as an SDK option first; the CLI is a thin client of it.

## One snippet from stdin

```bash
cat snippet.ts | jint str -                # extensionless: hint the grammar
cat snippet.go | jint str - --language go
```

The `str` noun declares piped stdin as one str unit (identity `str:stdin`). Its own inventory
is derived; no grammar is ever inferred and it never `WALK_FAILED`s. SDK: `lint({ str: { content } })`.

## Directory sweep

```bash
jint src/
```

The input kind is inferred by shape (exists-as-dir -> dir). The walk turns the tree into file
units (node_modules, .git, gitignored paths, binaries skipped; `exclude` prunes on top); walk
happens only where an inventory-scoped rule targets elements. Unsupported extensions are sweep
coverage, not errors: `parsing ts, tsx, py, go · not parsed (no grammar): .md, .json`.

## Single file

```bash
jint src/a.ts
```

Explicit path: the user asked for THIS file, so silence would read as "nothing wrong" — an
unknown extension fails `MISSING_GRAMMAR` naming the supported grammars (the walker skips
non-source silently; explicit does not).

## Path list

```bash
git diff --name-only HEAD~1 | jint paths -
jint paths - < list.txt
```

One flat list of paths, one per line — the caller's own VCS pipeline; jint never shells out and
never parses a VCS. Entries are the caller's bytes used verbatim; a malformed list is a named
`LIST_*` setup error; a listed path that resolves to nothing is a not-in-the-walk note, never a
silent skip. SDK: `lint({ paths: { content } })`.

## One element

```bash
jint src/a.ts@L58                # element whose span contains line 58: one classifier call
jint src/a.ts@L40-80             # every element fully enclosed in the range
jint src/a.ts@L40-80 --rule is_function_srp
```

The finding's `@L` is pre-edit; re-check at the element's CURRENT line, or re-run whole.

## Custom rules

```bash
cat > my.rule.ts <<'EOF'
import { defineConfig } from "jint:sdk";

export default defineConfig({
  rules: [
    {
      name: "is_error_message_actionable",
      target: "functions",
      classify: (self) => ({
        instructions: "…",
        criteria: { true: "…", false: "…" },
        state: { source: self.source },
      }),
      handle: { warn: { greater_than: 0.5 } },
    },
  ],
});
EOF
```

`customRules: ["my.rule.ts"]` in either config tier (paths resolved relative to the config
file). Handlers return data; jint, never the rule, calls the classifier. Duplicate names across
files fail at load.

## Package-scoped configs

```bash
cd packages/app && bun run check:jint
```

A package keeps its own `jint.config.json` (input, rule selection, excludes scoped to that
package) and a `check` script that runs the CLI with it — a repo of packages is a repo of
configs, not one config with path algebra.
