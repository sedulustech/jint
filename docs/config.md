---
title: Configuration
description: "One config file per run: the declarative and TypeScript tiers, the rules block, scope, and every run knob."
sidebar:
  label: Config
---

# Configuration

A run reads one config file. jint prefers `jint.config.ts` and falls back to `jint.config.json`.
`--config` overrides discovery. A run with no config fails and lists the rule domains, because jint
runs only the rules a config names.

Both tiers share one validation and resolve to the same shape.

## `jint.config.json`

The declarative tier is plain data. Nothing in it executes. Its schema is
[`jint.schema.json`](../jint.schema.json), for editor autocomplete through `$schema`.

- `input`: a file or directory path.
- `rules`: `{ include?, exclude?, use }`. `use` holds rule names or full rule objects. A repeated
  name is an error unless the later entry sets `override: true`. `include` and `exclude` are the
  default scope.
- `disable`: rule names to remove after composition.
- `concurrency`, `timeout`: the in-flight ceiling and the per-call timeout.

A config holds no key and no url, because a config is committed. The key you export picks the
endpoint. `OPENAI_API_KEY` asks the default url. `JINT_API_KEY` asks `JINT_API_URL`, which must end
in `/decisions`. A config that sets `apiKey` or `url` is an error.

## Rules

A rule object has a `name`, `instructions`, `criteria`, a `target` and a `handle`. It can add
`include` and `exclude` globs, and exclude always wins. See [What are rules?](what-are-rules.md).

A rule has one of three kinds:

- **`noul`** is a yes/no probability. Its criteria are `{ true, false }`.
- **`score`** is an ordered rubric. The handle rounds the expected level to the nearest level. Use
  it only when each level is worse than the one before.
- **`choice`** is a set of named options. The handle maps each option to a tier, and the tier with
  the most probability is the verdict.

Unordered categories break `score`. A reading split between level 0 and level 8 rounds to level 4,
a category the classifier did not choose. Use `choice` for unordered categories.

A choice can add `undecided: { margin, level, message? }`. It fires when the top tier leads the
runner-up by less than `margin`. See [confidence](confidence.md).

A choice reports one option per unit. To judge defects that can co-occur, write one `noul` rule per
defect. Rules on one unit share a classifier call, so separate questions add no calls.

A rule sees only the source of what it judges. A rule about the path, such as
`has_filename_mismatch`, sets `includePath: true` and receives the path with the source.

## Scope

The rules scope, `rules.include` and `rules.exclude`, sets which files jint reads and which
files a rule measures when it declares no scope of its own. A rule's own `include` and `exclude`
replace them for that rule.

- A file is read when `rules.include` or any rule's `include` matches it.
- A rule measures a file when its `include` names it and its own `exclude` does not subtract it.
  A broad rule `include` therefore weakens `rules.exclude`. Narrow the rule `include` where the
  exclude must win.
- A rule with no scope of its own never measures a file that only another rule's `include` claimed.
- The secret denylist and gitignore always win.

`jint run <file>` and `jint run paths -` are scope-checked: each path meets the same test as a
walked file. An unscoped rule skips a path the scope excludes and notes it. `--unscoped` (SDK: `unscoped`) drops the config scope
for named files. A rule's own scope still applies. A directory walk is always scoped.

A named file that cannot resolve, such as a missing path, is a hard error. A bad entry in a path
list is a note.

`git diff --name-only | jint run paths -` measures exactly a changeset. The pre-commit hook uses it.

## `jint.config.ts`

The imperative tier is a TypeScript module that default-exports `defineConfig({ ... })` from
`"jint:sdk"`. It takes the same keys as the JSON tier.

A config can import:

- `jint:sdk`, the typed config entry.
- `jint:rules/<domain>`, one domain's rules. Its version is the CLI's.
- Your own files, by relative or absolute path.

jint rejects bare npm specifiers and `node:*` builtins in the config file before it runs. This
fence keeps the config portable. It is not a sandbox, because a relative helper can import anything
the runtime offers.

### Inline custom rules

A `rules` entry with a `classify` function, a function `target` or a function `handle` is a custom
rule. Declarative entries beside it compile as usual.

```ts
import { rules as naming } from "jint:rules/naming";
import { defineConfig, type RuleSchema } from "jint:sdk";

const is_literal_shared: RuleSchema = {/* a full declarative spec */};

export default defineConfig({
  rules: {
    include: ["**/*.ts", "**/*.css"],
    use: [
      ...naming,
      is_literal_shared,
      {
        name: "is_comment_paired_with_code",
        target: "comments",
        classify: (self, ctx) => ({/* the question for this element */}),
        handle: { warn: { less_than: 0.4 }, error: { less_than: 0.15 } },
      },
    ],
  },
});
```

`classify(self, ctx)` returns the instructions, the criteria and a free-form `state` for one
element.

A `handle` function, `(results, ctx) => decisions`, runs once after classification. It returns one
decision per reading: `{ severity: "error" | "warn" | null, message? }`. A `null` severity is
silent. The `message` tells the caller how to fix the finding.

### Composition

- One module, one default export. There is no `extends`. A config that needs variants is two
  configs, and `--config` picks one.
- A rule name that appears twice is an error. To replace a rule, spread it and set
  `override: true`:

  ```ts
  use: [
    is_greppable,
    { ...is_greppable, include: ["src/**"], override: true },
  ],
  ```

- Names are global across declarative and custom rules. A custom rule that reuses a declarative
  name is a fatal `RULE_INVALID`.
- `disable` removes rules by name after composition.
- `rules: { use: [] }` alone is `CONFIG_NO_RULES`, because a run that measures nothing is an error.
