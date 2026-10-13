---
title: Grammar loading
status: draft
modified: 2026-10-12
---

## What exists today

The walker runs web-tree-sitter (wasm-only). Four grammars (typescript, tsx, go,
python) are compile-time imports in the walker: adding or replacing one means
eone and recompiling the binary. Each language also carries a mapping
(node-kind -> element role) hardcoded beside the grammar import.

## Decision

Two override seams, both user-facing, neither requiring a recompile:

| concern      | shipped default          | user override                                       |
| ------------ | ------------------------ | --------------------------------------------------- |
| grammar wasm | embedded at compile time | `$JINT_DIR/grammars/<lang>.wasm` wins when present  |
| mapping      | built into the walker    | `languages` key in jint.config merges over defaults |

- `JINT_DIR` defaults to `~/.jint`; the grammars dir is `$JINT_DIR/grammars/`.
  Follows the JEV_DIR precedent for moving roots off the homedir.
- Mapping merge is per node-kind key: a user entry replaces the default entry
  with the same key; keys the user does not name keep their default. There is no
  full-replace escape hatch until a use case arrives.
- A language with a user wasm and no mapping (built-in or configured) is a
  config error naming the language and the missing roles - a grammar that
  parses but extracts nothing fails loudly, not silently.
- Config is the only mapping surface: it already has the schema, validation, and
  TS tier. `languages` extends the existing config schema like `rules` does.

```ts
// jint.config.ts
export default defineConfig({
  languages: {
    python: {
      // replaces only these node kinds; the rest of python's defaults stay
      mappings: { function_definition: "function" },
    },
  },
});
```

## Rejections

| what                                      | why                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| sidecar `<lang>.map.json` beside the wasm | a second config authority: no schema tier, no validation, two places to look for the same concern |
| recompile to add a language               | status quo; forces binary releases for grammar churn                                              |
| auto-download grammars at lint time       | network in the measurement path; the user drops a prebuilt wasm in the dir instead                |
| full-replace mapping mode                 | speculative; per-key merge covers override without a second semantic                              |

## Definitions

- **grammar** - a tree-sitter language compiled to wasm; the parse-only half.
- **mapping** - the node-kind -> element-role table; the extraction half that
  turns a parse tree into elements.

## Questions

### Open

#### Grammar-version skew

A user wasm may name node kinds differently than the built-in mapping expects
(grammar majors rename kinds). Detection idea: warn when a mapping references
kinds the loaded grammar never produces. Undecided; ship without it and see.

### Settled

#### Where do mappings live - config or sidecar?

Config. (2026-10-12) It inherits the schema, validation, and TS tier; a sidecar
invents a parallel surface for one concern.

#### Can default mappings be overridden?

Yes - per-key merge, same name-replacement semantics rules already use. (2026-10-12)

#### Where do user wasms live?

`$JINT_DIR/grammars/<lang>.wasm`, default `~/.jint/grammars/`. (2026-10-12)
