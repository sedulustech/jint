<p align="center">
  <img src="logo.svg" width="160" alt="jint">
</p>

# jint, a semantic linter

`jint` constructs state with Treesitter, and classifies the state against a set of user defined rules using Typesafe's Jev.
It then turns the classification values into actionable output via per-rule callbacks.

[Read the blogpost!](https://sedulus.tech/blog/jint/)

Results:

- [jint being used to refactor a component of `jint`'s UI.](https://github.com/sedulustech/jint/commit/084f0af8b08a3261358d0f96d37dd6fa4a77cd36)
- [jint being used to refactor the input walker.](https://github.com/sedulustech/jint/commit/7a8297fc3eb766fc7314a7a7a6158c3f9e2e2fb8)

## Install

Install through NPM:

```bash
npm install -g @sedulus/jint@rc   # or a devDependency
npx @sedulus/jint@rc --version
```

Or through an install script:

```sh
curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/main/install.sh | bash
```

You can also set a specific version:

```sh
curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/main/install.sh | VERSION=v1.2.3 bash
```

To build from source, see [Development](#development).

### No runtime needed

The binary ships with virtual modules and the Bun runtime: you do not need to have a JS runtime locally to write your own `.ts` rules.

On Linux the only system requirement is glibc (any mainstream distro).
On musl-based images (Alpine), install a glibc layer first or use a glibc base image.

```ts
import { defaultRules } from "jint:defaults";

export default { rules: [...defaultRules] };
```

### Skill

Get the [skill file](SKILL.md) for the agent alongside the binary so it has clear instructions on how to behave.

## How to use

Jev is the only supported classifier for now.

```bash
export TYPESAFE_API_KEY=...   # required
```

```bash
jint src/                                # a directory tree
jint src/a.ts src/b.ts                   # explicit files
cat snippet.ts | jint str -              # piped stdin, one str unit (the only str form)
jint paths - < list.txt                  # a path LIST from a file, piped
git diff --name-only HEAD~1 | jint paths -   # a path LIST from your git pipeline
jint                                     # no positional: input comes from auto-discovered config
```

`jint` auto-discovers `jint.config.ts` or `jint.config.json` in the working directory.
`--config <path>` overrides discovery.

Every run records its requests to `~/.jint/runs/` (or what's set by `JINT_RUNS_DIR`).
The user grammar dir is `~/.jint/grammars` (or what's set by `JINT_GRAMMAR_DIR`) - the bring-your-own-grammar seam, docs/byog.md.

### Rules

```ts
// jint.config.ts
export default {
  input: "src/",
  rules: [
    {
      name: "is_cognitively_complex",
      kind: "choice",
      instructions:
        "How much EFFORT does a reader need to follow this code's logic - effort caused by structure the author chose, not by the problem itself? Ignore length alone: a long linear unit with one job reads as easy. Ignore inherent complexity: cases the data or the domain genuinely force are not this failure. Judge how hard the code's own structure makes it to read top-to-bottom.",
      criteria: [
        "Easy: the logic reads top-to-bottom. A single pass suffices. Any difficulty present is inherent to the problem, not to the structure.",
        "Moderate: the reader must pause once or twice - hold a small amount of state across a few lines, or re-check an outer condition - but the structure is otherwise linear and the full flow is recoverable by re-reading one or two spots.",
        "Hard: following the code requires actively reconstructing its flow - a stack of nested conditions to track, several unrelated concerns fused into one unit, state held across many lines, or an order that forces jumps instead of top-to-bottom reading. The structural difficulty could be removed without changing what the code does.",
      ],
      target: "definitions",
      handle: { map: ["pass", "warn", "error"] },
    },
  ],
};
```

`target` names what the rule judges, as one value or a list:

| target           | what it judges                                                                |
| ---------------- | ----------------------------------------------------------------------------- |
| `files`          | the whole file as one unit                                                    |
| `functions`      | each function or method                                                       |
| `classes`        | each class-like unit                                                          |
| `methods`        | each member function                                                          |
| `types`          | interfaces, structs, enums, aliases, sections                                 |
| `bindings`       | each name bound to a non-callable, non-type value                             |
| `definitions`    | every declaration except comments and imports                                 |
| `comments`       | the comment pair frame (a definition judged together with its owned comments) |
| `loose-comments` | comments with no definition frame                                             |
| `imports`        | the file's imports as one merged unit                                         |

Full table: docs/targets.md (generated from the live resolution).

A TS config rule may also carry a callback `handle: (results, ctx) => decisions`, called once after
classification with one decision per reading: `{ severity: "error" | "warn" | null, message? }`.
`null` severity is silent (measurement only). The optional `message` is an instruction to the caller fixing the finding; severity says whether, message says how - it renders beneath the finding line and rides the report as `finding.message`.

#### Default rules

The rules shipped as default were calibrated and dogfooded against jint's own `src/` and other repositories.

You can re-declare a default rule by name to override it.
Omitting `target` on an override keeps the default rule's own target.

Treat default rules as a starting point and tune once you understand how `jint` works and have your own rules to enforce.

The authoritative list of default rules lives in [`packages/defaults/src/index.ts`](packages/defaults/src/index.ts).

## UI

`jint --ui` opens a local dashboard useful for rule calibrations.
It polls the run directory for new runs and displays useful information to verify the applicability of a rule to a lexical unit. It shows, among other things:

- tokens used
- duration
- requests made
- summary of the run
- warning and errors grouped by rule and files

## Development

```bash
bun install
bun run validate        # schema -> typecheck -> lint
bun test                # full suite
bun run build:compile   # builds the binary
```

## Glossary

The canonical vocabulary to understand the codebase lives in [GLOSSARY.md](GLOSSARY.md).
It is the constraint the code and docs are held to, so it is maintained there rather than copied here.
