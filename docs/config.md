# Configuration

One config file per run, two tiers. Discovery prefers `jint.config.ts` and falls back to
`jint.config.json`; `--config` overrides discovery; a run with no config file fails and lists the rule domains (jint
runs only the rules a config names; `capture` needs none). Both tiers share one validation boundary
(`validateConfig`) and resolve to the same `ResolvedConfig` shape.

## Tier 1: `jint.config.json` — declarative

Plain JSON (no comments, no code): data only, the engine owns every behavior, so nothing here
executes and no import gate is needed. Loaded by `loadDeclarativeConfig`, validated against
`CONFIG_SCHEMA` — the same schema emitted verbatim as the checked-in [`jint.schema.json`](../jint.schema.json)
for editor autocomplete via `$schema`.

| key                                      | value                                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input`                                  | path positional (a file or directory)                                                                                                                                                                         |
| `rules`                                  | `{ include?, exclude?, use }`: `use` holds rule **names** or full rule objects (a repeated name is an error unless `override: true`); `include`/`exclude` are the default scope of every rule; absent = error |
| `disable`                                | rule names removed after composition                                                                                                                                                                          |
| `concurrency` / `rps_budget` / `timeout` | run knobs (in-flight ceiling, request-start budget, per-call timeout)                                                                                                                                         |
| `url`                                    | the Decisions endpoint asked (must end in `/decisions`); overrides `JINT_API_URL`                                                                                                                             |
| `apiKey`                                 | the key for this run; overrides `JINT_API_KEY` and `OPENAI_API_KEY`                                                                                                                                           |

`url` and `apiKey` choose where a run asks. Without them, the key you export picks the endpoint:
`OPENAI_API_KEY` asks the default url, and `JINT_API_KEY` asks `JINT_API_URL`
(the [README](../README.md#how-to-use) has the full table). Keep `apiKey` out of a committed config.

A rule object is a [default-rule-shaped spec](rules.md): `name`, `instructions`, `criteria`
(`{true, false}` for noul, an ordered rubric for `kind: "score"`, named options for
`kind: "choice"`), `target`, `handle`, plus
per-rule `include`/`exclude` globs (exclude always wins; a rule whose exclude cancels its
include is a warning, never an error).

**Choosing a kind.** A rule is `noul` (a yes/no probability), `score` (an ordered rubric), or
`choice` (named options). A score answer is the expected level, and the handle rounds it to the
nearest level. Use `score` only when the levels sit on one axis, each worse than the one before.
Unordered categories break that read: a reading split evenly between level 0 and level 8 rounds to
level 4, a category the classifier did not choose, and the finding carries level 4's message. For
unordered categories, use `choice`: the classifier spreads probability over the options, and the
handle maps each option label to a tier (`{ "choices": { "<label>": "pass" | "warn" | "error" | { level, message } } }`).
The tier holding the most probability is the verdict; its most probable option supplies the message.
An optional `undecided: { margin, level, message? }` fires when the top tier's probability leads
the runner-up tier's by less than `margin`: an undecided reading, acted on like any other tier (docs/confidence.md). A choice reports one option per unit. To
judge independent defects that can co-occur, write one noul rule per defect. Each rule is its own question with its own probability, threshold, and
message, and one unit can fail several at once. The rules on one unit batch into one classifier
call, so separate questions add no calls.

**The rules scope.** `rules: { include, exclude, use }` - `include` and `exclude` answer two
questions: which files the walk reads, and which files a rule measures when it declares no `include`
of its own. A rule's own `include`/`exclude` overrides them for that rule. Top-level `include`/`exclude`
keys and a bare `rules` array no longer exist: a config that still has them fails with the move named.

**Walk-union discovery: scopes and admission.** A file is walked when `rules.include`
OR any rule's `include` matches. A rule claims a file when its `include` names it AND its own
`exclude` does not subtract it: the claim carries across `rules.exclude` (the more specific
scope wins, gitignore style). Consequence: a BROAD rule `include` makes `rules.exclude` soft
for what it names — only the denylist (and gitignore) stay walls; narrow the rule `include`
where the exclude must win. Each rule then measures only files its own scope admits: unscoped
rules (no `include` of their own) follow the config scope and never measure a file only a rule
include claimed. `run.input.admitted` attributes every included file to its scope (`config` or
`rule:<name>`) — for walked discovery AND named operands alike.

**Named files and a path list mean the same thing.** `jint run <file>` and `jint run paths -`
(a piped list) are both scope-checked: each path is tested against the one config-scope test
(include whitelist AND not excluded). A path inside the config scope is measured by unscoped
rules exactly as a walked file is. A path the scope excludes is skipped by every unscoped rule,
with one note naming the file and the way out; a rule `include` claims it across the config
exclude, as in the walk. A path nothing claims measures nothing - a note, never silence. The run
header states the scope in effect and which of these applied.

**`--unscoped` measures them as given.** The flag drops the config scope for named files and a
path list: you named the files, so those are the files. A rule's own `include`/`exclude` still
scopes that rule, because it records where the rule's claim holds, and a calibrated rule does not
judge files it was never calibrated on. A directory walk is always scoped; `--unscoped` on one is
a usage error. The SDK option is `unscoped`.

**Resolve failures and the denylist.** A named file that fails to RESOLVE (missing path, no
grammar) throws its hard error: naming a broken file is explicit consent to hear about the break.
A path-list entry that is missing or that no grammar claims becomes a note and the run goes on.
The secret denylist is not a scope - it is an always-win exclusion and applies to named paths
too (naming a secret-shaped path does not hand its contents to the classifier; pattern-level -
the PEM content sniff stays walk-only, an innocent-named operand is explicit consent like piped
source). The `str` noun has no real path, so no scope applies; an element-scope run pins its
selector file, which scope-checks like any operand. Capture's explicit FILE target bypasses the
walk scoping (it prints structure, no classifier) - but its `--rule` preview marker applies the
same scope predicate. `jint run paths -` is how to measure exactly a changeset
(`git diff --name-only | jint run paths -`); the pre-commit hook does.

## Tier 2: `jint.config.ts` — imperative composition

A TS module default-exporting `defineConfig({ ... })` from `"jint:sdk"`, loaded by `loadTsConfig`
through the import gate (imports scanned before the module ever runs). A TS config takes the same
keys a config file takes, minus `customRules` — there is no `customRules` key anywhere.

Rule sources importable from the config:

| source                | what it is                                                              | versioning                               |
| --------------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| `jint:sdk`            | `defineConfig` — the typed config entry                                 | virtual module, compiled-in              |
| `jint:rules/<domain>` | one domain's declarative specs (`rules` + each rule under its own name) | virtual module; its version IS the CLI's |
| `./`, `../`, absolute | your own files                                                          | —                                        |

Bare npm specifiers and `node:*` builtins are rejected in the config file before it runs. The
gate is a portability fence for the entry file, not a sandbox: it scans that file's static
imports only, so a relative helper may import anything the runtime offers. The domains are
`comments`, `complexity`, `errors` and `naming`; [rules.md](rules.md) lists every rule in each.
jint runs only the rules the config names: a config with no rules fails with the domain list.
A rule name that appears twice is an error unless the later entry sets `override: true`.

### Inline custom rules

A `rules` entry that carries a callback — a `classify` function, a function `target`, or a
function `handle` — is an inline custom rule: it runs on the callback engine (element
inventories, free state composition) while declarative entries around it compile through the same
seam as the JSON tier. This is the repo-root pattern:

```ts
import { rules as naming } from "jint:rules/naming";
import { defineConfig, type RuleSchema } from "jint:sdk";

const is_literal_shared: RuleSchema = {/* a full declarative spec, authored in-file */};

export default defineConfig({
  rules: {
    include: ["**/*.ts", "**/*.css"],
    use: [
      ...naming,
      is_literal_shared,
      {
        name: "is_comment_paired_with_code",
        target: "comments",
        classify: (self, ctx) => ({/* free state composition */}),
        handle: { warn: { less_than: 0.4 }, error: { less_than: 0.15 } },
      },
    ],
  },
});
```

The pattern above is the complete shape: a callback rule is a config `rules` entry whose
`classify(self, ctx)` returns the question for that element (instructions, criteria, and a
free-form `state` object the rule composes - the pairing IS the state); the repo root's own
`jint.config.ts` mixes the shipped domains with an inline declarative rule the same way.

The `handle` may instead be a `(results, ctx) => decisions` function, called once after
classification with one decision per reading: `{ severity: "error" | "warn" | null, message? }`.
`null` severity is silent (measurement only). `message` is an instruction to the caller fixing the finding; severity says whether, message says how - it renders beneath the finding line and rides the report as `finding.message`. Tiered decisions are natural: the handle sees the raw readings, so it can branch on them (e.g. a deep miss vs a marginal one) into different remediation instructions.

### Composition rules

- Composition is **in-file**: one module, one default export. No `extends`, no cross-file merge —
  rejected by design; a config that needs variants is two configs (`--config` picks one).
- A rule name that appears twice is an error naming both entries; replace a rule by spreading it and
  setting `override: true`:
  ```ts
  export default defineConfig({
    rules: {
      use: [
        is_greppable,
        {
          ...is_greppable,
          include: ["src/**"],
          handle: { warn: { less_than: 0.8 } },
          override: true,
        },
      ],
    },
  });
  ```
  runs one `is_greppable`, the tighter one.
- Names are global across the two rule forms: a callback rule re-declaring a declarative entry's
  name (or vice versa) is a fatal `RULE_INVALID`, not an override.
- `disable` removes by name after composition; `rules: { use: [] }` alone is `CONFIG_NO_RULES` (a run that
  would measure nothing is a config error).
- Scoping is per rule: each entry's own `include`/`exclude` globs (exclude always wins) replace the
  rules scope for that rule. A rule `include` is also a DISCOVERY scope (walk-union, above) - a rule
  wanting a file type `rules.include` excludes admits it by naming it; no global carve-out is
  ever needed.
