# Configuration

One config file per run, two tiers. Discovery prefers `jint.config.ts` and falls back to
`jint.config.json`; `--config` overrides discovery; no config file means the built-in defaults
(all default rules, input from the CLI positional). Both tiers share one validation boundary
(`validateConfig`) and resolve to the same `ResolvedConfig` shape.

## Tier 1: `jint.config.json` — declarative

Plain JSON (no comments, no code): data only, the engine owns every behavior, so nothing here
executes and no import gate is needed. Loaded by `loadDeclarativeConfig`, validated against
`CONFIG_SCHEMA` — the same schema emitted verbatim as the checked-in [`jint.schema.json`](../jint.schema.json)
for editor autocomplete via `$schema`.

| key                                      | value                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `input`                                  | path positional (a file or directory)                                                                           |
| `rules`                                  | default rule **names** or full rule objects; last wins per name; absent = all defaults                          |
| `disable`                                | rule names removed after composition                                                                            |
| `customRules`                            | paths to TS rule files (default-exporting `defineConfig` from `jint:sdk`), resolved relative to the config file |
| `exclude`                                | input exclusion globs, on top of the walker's defaults                                                          |
| `concurrency` / `rps_budget` / `timeout` | run knobs (in-flight ceiling, request-start budget, per-call timeout)                                           |

A rule object is a [default-rule-shaped spec](rules.mdx): `name`, `instructions`, `criteria`
(`{true, false}` for noul, an ordered rubric for `kind: "choice"`), `target`, `handle`, plus
per-rule `include`/`exclude` globs (exclude always wins; a rule whose exclude cancels its
include is a warning, never an error).

## Tier 2: `jint.config.ts` — imperative composition

A TS module default-exporting `defineConfig({ rules: [...] })` from `"jint:sdk"`, loaded by
`loadTsConfig` through the custom-rule import gate (imports scanned before the module ever runs).

Rule sources importable from the config:

| source                | what it is                                                         | versioning                                      |
| --------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| `jint:sdk`            | `defineConfig` — the rule-author API                               | virtual module, compiled-in                     |
| `jint:defaults`       | the declarative default specs (`defaultRuleSpecs` + named exports) | virtual module; its version IS the CLI baseline |
| `@jint/defaults`      | the same specs as a real package                                   | workspace / install-versioned                   |
| `./`, `../`, absolute | your own files                                                     | —                                               |

Bare npm specifiers and `node:*` builtins are rejected before execution. External users and
compiled binaries use `jint:defaults` (no install needed); workspace consumers may prefer
`@jint/defaults` to pin their own version.

### Composition rules

- Composition is **in-file**: one module, one default export. No `extends`, no cross-file merge —
  rejected by design; a config that needs variants is two configs (`--config` picks one).
- Entries compose **last wins by rule name**: re-declaring a name replaces the earlier entry, so
  ```ts
  export default defineConfig({
    rules: [
      defaultRuleSpecs.is_greppable,
      { ...is_greppable, include: ["src/**"], handle: { warn: { less_than: 0.8 } } },
    ],
  });
  ```
  runs one `is_greppable`, the tighter one.
- `disable` removes by name after composition; `rules: []` is legal only when `customRules`
  supply the set (a run that would measure nothing is `CONFIG_NO_RULES`).
- A `defineConfig` **fragment** may carry `include`/`exclude`, inherited by its rules; a
  rule's own scoping replaces the fragment default.
