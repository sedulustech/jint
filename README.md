<p align="center">
  <img src="logo.svg" width="160" alt="jint">
</p>

# jint, a semantic linter

`jint` constructs state with Treesitter, and classifies the state against a set of user defined rules using Typesafe's Jev.
It then turns the classification values into actionable output via per-rule callbacks.

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
VERSION=v1.2.3 curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/main/install.sh | bash   # pin a version
```

To build from source, see [Development](#development).

### No runtime needed

The binary ships with virtual modules and the Bun runtime: you do not need to have a JS runtime locally to write your own `.ts` rules.

```ts
import { defaultRules } from "jint:defaults";

export default { rules: [...defaultRules] };
```

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

`jint` auto-discovers `jint.config.ts` in the working directory.
`--config <path>` overrides discovery.

Every run records its requests to `~/.jint/runs/` (or what's set by `JINT_DIR`).

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

| target        | what it judges                                        |
| ------------- | ----------------------------------------------------- |
| `files`       | the whole file as one unit                            |
| `functions`   | each function or method                               |
| `definitions` | every declaration except comments and imports         |
| `comments`    | each comment, including one attached to a declaration |
| `imports`     | the file's imports as one merged unit                 |

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
bun test            # incl. calibration checks
bun run validate    # schema -> typecheck -> lint -> build
```

## Glossary

The canonical vocabulary to understand the codebase lives in [GLOSSARY.md](GLOSSARY.md).
It is the constraint the code and docs are held to, so it is maintained there rather than copied here.
