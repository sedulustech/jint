---
title: How to use
description: "jint is for your agent to verify its own work, with rules you tune in the UI. Ways to run it: stdin, files, directories, and the SDK."
sidebar:
  label: How to use
---

# How to use

## Who runs jint

jint is meant to be run by your agent, not by you. The agent writes code, runs jint over it, reads
the findings, and fixes them before it hands the work back. That is how it checks its own work.

You still have a job: set the rules to your liking. In the run UI you edit a rule's question and
the code it reads, classify it, and compare the readings until the rule judges what you mean. You
do not write the rule's logic, only the question and the evidence.

Once a rule is set, the agent has to meet it. A rule is stronger than a rubric. A rubric is text
the agent reads and applies by its own judgment, and nothing checks that it did. A rule is run by
jint after the work, in CI or in a pre-commit hook. It returns an action for the agent to take:
the rule's handle gives a severity and a message that says what to do. An error fails the hook
and sets the exit code, so the agent has to act on it before the work goes through.

The goal is rules calibrated to your code, so that they fire only when they need to. A rule that
reads wrongly blocks good work or lets bad work pass. See [Calibration](calibration.md) for how
to test a rule and edit it until it is right.

## Ways to run it

Every form exists as an SDK option first; the CLI is a thin client of it.

## One snippet from stdin

```bash
cat snippet.ts | jint run str -                # extensionless: hint the grammar
cat snippet.go | jint run str - --language go
```

The `str` noun declares piped stdin as one str unit (identity `str:stdin`). Its own inventory
is derived; no grammar is ever inferred and it never `WALK_FAILED`s. SDK: `lint({ str: { content } })`.

## Directory sweep

```bash
jint run src/
```

The input kind is inferred by shape (exists-as-dir -> dir). The walk turns the tree into file
units (node_modules, .git, gitignored paths, binaries skipped; `exclude` prunes on top); walk
happens only where an inventory-scoped rule targets elements. Unsupported extensions are sweep
coverage, not errors: `parsing ts, tsx, py, go · not parsed (no grammar): .md, .json`.

## Single file

```bash
jint run src/a.ts
```

Explicit path: the user asked for THIS file, so silence would read as "nothing wrong" — an
unknown extension fails `MISSING_GRAMMAR` naming the supported grammars (the walker skips
non-source silently; explicit does not).

## Path list

```bash
git diff --name-only HEAD~1 | jint run paths -
jint run paths - < list.txt
```

One flat list of paths, one per line — the caller's own VCS pipeline; jint never shells out and
never parses a VCS. Entries are the caller's bytes used verbatim; a malformed list is a named
`LIST_*` setup error; a listed path that resolves to nothing is a not-in-the-walk note, never a
silent skip. SDK: `lint({ paths: { content } })`.

## One element

```bash
jint run src/a.ts@L58                # element whose span contains line 58: one classifier call
jint run src/a.ts@L40-80             # every element fully enclosed in the range
jint run src/a.ts@L40-80 --rule is_function_srp
```

The finding's `@L` is pre-edit; re-check at the element's CURRENT line, or re-run whole.

## Custom rules

Custom rules are authored INLINE in a TS config's `rules` array (the config takes the same keys a
cconfig file takes): a declarative rule composed next to the shipped domains, or a callback rule for the
cases data can't express.

```bash
cat > jint.config.ts <<'EOF'
import { rules as naming } from "jint:rules/naming";
import { defineConfig } from "jint:sdk";

export default defineConfig({
  rules: { use: [
    ...naming,
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
  ] },
});
EOF
```

Handlers return data; jint, never the rule, calls the classifier. Names are global: a callback
rule re-declaring a declarative rule's name is a fatal load error.

## Package-scoped configs

```bash
cd packages/app && bun run check:jint
```

A package keeps its own `jint.config.json` (input, rule selection, excludes scoped to that
package) and a `check` script that runs the CLI with it — a repo of packages is a repo of
configs, not one config with path algebra.
