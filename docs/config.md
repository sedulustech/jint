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

| key                                      | value                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `input`                                  | path positional (a file or directory)                                                  |
| `rules`                                  | default rule **names** or full rule objects; last wins per name; absent = all defaults |
| `disable`                                | rule names removed after composition                                                   |
| `exclude`                                | input exclusion globs, on top of the walker's defaults                                 |
| `concurrency` / `rps_budget` / `timeout` | run knobs (in-flight ceiling, request-start budget, per-call timeout)                  |

A rule object is a [default-rule-shaped spec](rules.md): `name`, `instructions`, `criteria`
(`{true, false}` for noul, an ordered rubric for `kind: "choice"`), `target`, `handle`, plus
per-rule `include`/`exclude` globs (exclude always wins; a rule whose exclude cancels its
include is a warning, never an error).

## Tier 2: `jint.config.ts` — imperative composition

A TS module default-exporting `defineConfig({ ... })` from `"jint:sdk"`, loaded by `loadTsConfig`
through the import gate (imports scanned before the module ever runs). A TS config takes the same
keys a config file takes, minus `customRules` — there is no `customRules` key anywhere.

Rule sources importable from the config:

| source                | what it is                                                     | versioning                                      |
| --------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| `jint:sdk`            | `defineConfig` — the typed config entry                        | virtual module, compiled-in                     |
| `jint:defaults`       | the declarative default specs (`defaultRules` + named exports) | virtual module; its version IS the CLI baseline |
| `@jint/defaults`      | the same specs as a real package                               | workspace / install-versioned                   |
| `./`, `../`, absolute | your own files                                                 | —                                               |

Bare npm specifiers and `node:*` builtins are rejected before execution. External users and
compiled binaries use `jint:defaults` (no install needed); workspace consumers may prefer
`@jint/defaults` to pin their own version.

### Inline custom rules

A `rules` entry that carries a callback — a `classify` function, a function `target`, or a
`handleClassification` — is an inline custom rule: it runs on the callback engine (element
inventories, free state composition) while declarative entries around it compile through the same
seam as the JSON tier. This is the repo-root pattern:

```ts
import { defaultRules, type RuleSpec } from "@jint/defaults";
import { defineConfig } from "jint:sdk";

const is_literal_shared: RuleSpec = {/* a full declarative spec, authored in-file */};

export default defineConfig({
  rules: [
    ...defaultRules,
    is_literal_shared,
    {
      name: "is_comment_paired_with_code",
      target: "comments",
      classify: (self, ctx) => ({/* free state composition */}),
      handle: { warn: { less_than: 0.4 }, error: { less_than: 0.15 } },
    },
  ],
  include: ["**/*.ts", "**/*.css"],
});
```

See [`examples/rules/is-comment-paired.ts`](../examples/rules/is-comment-paired.ts) for a complete
config with one inline callback rule.

### Composition rules

- Composition is **in-file**: one module, one default export. No `extends`, no cross-file merge —
  rejected by design; a config that needs variants is two configs (`--config` picks one).
- Entries compose **last wins by rule name**: re-declaring a name replaces the earlier entry, so
  ```ts
  export default defineConfig({
    rules: [
      is_greppable,
      { ...is_greppable, include: ["src/**"], handle: { warn: { less_than: 0.8 } } },
    ],
  });
  ```
  runs one `is_greppable`, the tighter one.
- Names are global across the two rule forms: a callback rule re-declaring a declarative entry's
  name (or vice versa) is a fatal `RULE_INVALID`, not an override.
- `disable` removes by name after composition; `rules: []` alone is `CONFIG_NO_RULES` (a run that
  would measure nothing is a config error).
- Scoping is per rule: each entry's own `include`/`exclude` globs (exclude always wins).
