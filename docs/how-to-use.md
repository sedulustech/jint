---
title: How to use
description: "Ways to run it: stdin, files, directories, and the SDK."
sidebar:
  label: How to use
---

# How to use

Every form exists as an SDK option first and the CLI is a thin client of it.

## One snippet from stdin

```bash
cat snippet.ts | jint run str -                # extensionless: hint the grammar
cat snippet.go | jint run str - --language go
```

## Directories

```bash
jint run src/
```

## Single file

Explicit paths.

```bash
jint run src/a.ts
```

## Path list

```bash
git diff --name-only HEAD~1 | jint run paths -
jint run paths - < list.txt
```

Useful for a pre-commit hook.

## One element

```bash
jint run src/a.ts@L58                # element whose span contains line 58: one classifier call
jint run src/a.ts@L40-80             # every element fully enclosed in the range
jint run src/a.ts@L40-80 --rule is_function_srp
```
