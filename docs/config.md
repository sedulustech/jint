---
title: Configuration
description: "One config file per run: every key, in its JSON and TypeScript forms."
sidebar:
  label: Config
---

# Configuration

A run reads one config file, either in `.json` or `.ts` form.

`jint.config.ts` has precedence. `--config` overrides discovery. A run with no config fails.

<!-- generated:config — do not edit. Regenerate with `bun run schema`. -->

```ts
import { defineConfig } from "jint:sdk";

export default defineConfig({
  // The file or directory to measure. A path given to jint run overrides it.
  input: "src/",
  // Whether input is a file or a directory.
  inputType: "dir",
  rules: {
    // The files jint reads, and the default scope of every rule.
    include: ["**/*.ts"],
    // The files jint skips. Exclude always wins over include.
    exclude: ["**/*.test.ts"],
    // The rules to run: names from a rule domain, or full rule objects.
    use: ["is_greppable", "is_function_srp"],
  },
  // Replaces the built-in denylist of secret-shaped files (gitignore patterns).
  secretDenylist: ["!.env.example"],
  // Rule names to remove after the rules are composed.
  disable: ["is_function_srp"],
  // The most classifier calls in flight, run-wide. Default 16, max 64.
  concurrency: 16,
  // The timeout of one classifier call, in seconds. Default 30.
  timeout: 30,
});
```

<!-- /generated:config -->

## `jint.config.json`

The declarative tier is plain data. Nothing in it executes. We ship a JSON schema for editor
autocomplete.

## `jint.config.ts`

The imperative configuration is a TypeScript module that default-exports `defineConfig({ ... })` from
`"jint:sdk"`. It takes the same keys as the JSON tier.

jint rejects bare npm specifiers and `node:*` builtins in the config file before it runs. This
fence keeps the config portable. It is not a sandbox, because a relative helper can import anything
the runtime offers.
