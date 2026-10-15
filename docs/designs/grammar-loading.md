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

## Kickoff (revised Oct 15: evidence-first, not abstraction-first)

Direction: fresh branch from main; embed-all is REFERENCE ONLY. Ship the
minimum walker first (query runtime + capture vocabulary + passthrough);
INTERIOR POLICY, SPAN RULES, and OVERLAP HANDLING are NOT pre-decided -
they are extracted grammar by grammar while porting, and frozen only when
evidence agrees. The ten trial verdicts are the pre-loaded corpus of known
demands (absorb: ts export, python decorators, cpp templates; overlap:
md section+paragraphs wanted, ts member-chains unwanted; names: 6-language
hardcode evidence). Known candidate defaults to test, not assume: span =
captured node (absorb becomes pattern authoring); different-capture overlap
legal, same-name nesting suppressed; per-noun descent defaults.

Naming (deepseek round 4, adopted): the three rule-target namespaces are
FILE / NODE TYPE / CAPTURE. file = whole file as one judgment unit.
node type = one grammar's raw tree-sitter type, grammar-local
(lang:node_type), no shared meaning. capture = the jint-owned shared noun a
query assigns to a matched node (function, type, binding); singular names
what one element is, plural addresses the group a rule targets. Glossary
rewrite in the same series: capture REPLACES role (the living collision);
kill 'declared target', 'primitive', 'implicit lane', 'atomic target';
'noun' stays owned by the CLI - never used for the vocabulary. A capture
name is an identity, never a label.

Mid-build assignments unchanged: five captures for v1; static capture
analysis over-approximates under predicates; predicates #eq?/#match? only;
degraded-mode runtime warning ported; MDX excluded (issue #9); md inline
parked.

## Questions

### Open

#### Grammar manifest and provisioning

Superseded by "Loading, not fetching" below - loading only, no fetch command.
The manifest format question moved to "Mapping shape reopened".

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

#### Loading, not fetching (supersedes the provisioning question)

jint loads grammars present in the grammar dir. Fetching grammars is not
jint's responsibility - no registry, no checksums, no fetch command. Revisit
only if a real demand arrives.

#### Mapping shape reopened: mapping.ts

Declaring which structures to surface is not a flat kind-to-role table.
wrapperTypes (unwrap lists) and non-trivial name extraction (sibling
declarators, decorators) are extraction knowledge, not facts. Proposal:

    <lang>.manifest.json   facts pinned with the wasm: version, extensions
    <lang>.mapping.ts      extraction: kind-to-role table + unwrap + names

The mapping loads like the config: a virtual module (jint:grammar) supplies
defineGrammarMapping - no install, works in compiled binaries. Trade: kind-set
validation covers the table portion only; code cannot be statically checked.

#### Extension conflicts deferred to override

File routing (which language owns an extension) is entangled with grammar
override (issue pending). Current behavior is silent-wins; recorded as known
and deferred, not specified.

#### Kind-usage gap is a known limit, not an open problem

The never-occurring-but-spellable key scenario was not observed in the spike;
the failing case was a misspelling, which validation catches. No frequency
machinery without a corpus that demonstrates the failure.

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

## Per-format isolation requirements

The input to the mapping shape: what each format wants isolated, attached,
and contextual. Requirements FIRST, walker policy derived from them.

| format  | isolate (elements)                                   | attach                                         | context/notes                                                                                                                                                                                                                                                                                                      |
| ------- | ---------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ts/tsx  | functions, types, bindings                           | leading comments, docstrings                   | composite classes; export/decorator prefixes                                                                                                                                                                                                                                                                       |
| python  | functions, types, bindings                           | docstrings (string-in-block)                   | decorator prefixes                                                                                                                                                                                                                                                                                                 |
| go      | functions, types, bindings                           | doc comments                                   | package-per-dir convention                                                                                                                                                                                                                                                                                         |
| rust    | functions, types, bindings                           | doc comments (///)                             | impl blocks composite                                                                                                                                                                                                                                                                                              |
| c       | functions, types, bindings                           | comments; prototypes must split from variables | declarator depth; macros invisible                                                                                                                                                                                                                                                                                 |
| cpp     | + methods, fields (distinct from bindings?)          | comments                                       | template headers; namespaces composite                                                                                                                                                                                                                                                                             |
| css     | rule sets, declarations                              | lead comments to rule sets                     | value-position calls (calc/var) NOT functions                                                                                                                                                                                                                                                                      |
| md      | headings, paragraphs, code blocks, sections-as-units | intro-paragraph-as-docstring                   | granularity is rule-side: some rules want paragraphs, some section+intro together; fenced code wants embed handoff; frontmatter = minus_metadata node, transits safely outside sections (v1: invisible; comment-lane mapping if a rule wants metadata); MDX: NO for v1 (grammar immature, no wasm, injection cost) |
| php     | functions, methods, classes                          | docblocks                                      | closures; use-aliases                                                                                                                                                                                                                                                                                              |
| verilog | modules, always blocks, instances?, ports?           | header comments colocated like code languages? | 988 node types; generate blocks                                                                                                                                                                                                                                                                                    |

Settled by embedding: CI determinism - grammars ship in the binary, no
homedir state affects a run; same commit = same report.

## Keyword convergence (evidence for the owned-noun layer)

Node-type keywords across the ten grammars, for each noun:

| noun     | keywords                                                                                                                                                     | convergence                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| function | function_definition (c/cpp/py/php), function_declaration (go/ts/tsx), function_item (rust), method_declaration (go/php), always_construct (verilog, stretch) | HIGH - stem `function_*` in 8/8 code grammars; suffix (_definition/_declaration/_item) sometimes carries semantics (rust function_item vs function_signature_item) |
| type     | class / struct_specifier / interface_type / enum_specifier / module_declaration / section                                                                    | NONE - no shared stem                                                                                                                                              |
| binding  | declaration / variable_declarator / const_declaration / net_declaration / field_declaration                                                                  | WORSE - shared stem `declaration` is the overloaded trap (go field_declaration = struct field; cpp declaration = variables AND prototypes)                         |

Verdict: the inter-language noun cannot be derived from grammar keywords.
Keywords name parse SHAPES, not semantic ROLES (function_type is a type;
class_static_block is neither). The noun is an owned abstraction the query
file ASSIGNS: @element.function on function_definition (c), function_item
(rust), always_construct (verilog, stretch-annotated). NAMING RULE: singular
nouns for captures (what one element IS); plural forms for the rule-target
group-addressing layer ("the function elements of this file") - the split
today's resolution grammar already ships.

Node-type inventories for all ten grammars dumped at /tmp/node-types/
(<lang>.node-types.json full facts, <lang>.types.txt names only).
