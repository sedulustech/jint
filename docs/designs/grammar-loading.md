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
  Follows the JINT_DIR precedent for moving roots off the homedir.
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

#### Grammar manifest and provisioning

A user grammar needs a pinned version, extensions, and a fetchable source.
Local untracked checkouts are not a source: validation must not depend on what
happens to sit on disk. Open: the manifest format and the provisioning command.

#### Overriding built-in grammars

Replacing an embedded grammar (same language, other wasm) is a separate concern
from adding one. Possibly its own issue; out of scope here.

#### Will official grammars keep shipping while BYOG is open?

Unanswered. Embedded grammars pin versions, pass CI, and need no user setup.
BYOG shifts nothing for them in principle - but it may change the cadence:
fewer embedded additions, embedded set frozen at the current four, or
embedded grammars becoming thin pins on manifests. Decide from the spike's
difficulty verdict.

#### Kind-set validation is approximable, not exact

`nodeTypeForId` enumerates the grammar's declared kinds - a superset of what
occurs in real trees. Validation catches misspelled keys, not keys that are
spellable but never match. Per-kind frequency validation would close the gap;
costs more than the core feature.

#### wrapperTypes have no manifest home

The walker's unwrap step (export wrappers, decorated definitions) is per-
language knowledge. The manifest carries no field for it; user grammars get an
empty list and wrapper-having languages mis-map. Needs a manifest field or a
declared limitation.

#### Extension conflicts are silent-wins

A user grammar claiming an extension an embedded grammar also claims (`.ts`)
reroutes the file with no signal. Needs a specified behavior - loud failure or
a note naming both grammars.

#### Provenance stops at the Inventory

`Inventory.provenance` records the grammar source per parse, but neither the
run record nor the report schema carries it. Threading it through is contract
work; it also unblocks UI syntax highlighting for unknown languages (see
below).

#### UI highlighting is the one grammar-aware surface

The UI consumes targets and is grammar-blind, except CodeBlock's hardcoded
four-language highlight.js map. Near term: widen the map statically. Correct:
derive highlighting from provenance once it reaches the run record.

#### Grammar-version skew

A user wasm may name node kinds differently than the built-in mapping expects
(grammar majors rename kinds). Detection idea: warn when a mapping references
kinds the loaded grammar never produces. Undecided; ship without it and see.

### Settled

#### Config and grammars are orthogonal

The config never mentions languages. The grammar dir owns everything grammar-
shaped: wasm (parse), manifest (version, extensions, base mapping = extraction).
A manifest without a wasm shadows an embedded grammar's mapping. Kind-set
validation guards the manifest - the only tier a human writes by hand.

A node-kind-to-role mapping is a claim about the language, not the project.
Per-project mapping disagreement wants to be a rule (judgment, config-owned),
not a mapping (extraction fact, grammar-dir-owned). If that proves wrong, a
config languages tier is additive later.

Supersede note: the 2026-10-12 decision "mappings live in config" predates the
manifest; with version-pinned manifests it is withdrawn. The rejected sidecar
stays rejected - an unpinned user-editable parallel authority is still wrong.

Out of scope for now: shareability and colocation. A repo cannot today point at
a colocated grammar dir. The config will probably hold a `grammars.path` option
for that case; deferred until a sharing use case arrives.

#### Where do mappings live - config or sidecar?

Config. (2026-10-12) It inherits the schema, validation, and TS tier; a sidecar
invents a parallel surface for one concern.

#### Can default mappings be overridden?

Yes - per-key merge, same name-replacement semantics rules already use. (2026-10-12)

#### Where do user wasms live?

`$JINT_DIR/grammars/<lang>.wasm`, default `~/.jint/grammars/`. (2026-10-12)
