---
title: BYOG — bring your own grammar
description: The custom grammar seam: register any tree-sitter grammar, keep jint's capture vocabulary, and encode domain review questions as rules. Worked example: verilog.
---

# BYOG — bring your own grammar

The nine embedded grammars are not special. Each is a directory of three artifacts registered
through the same shape any custom grammar uses at runtime — and the same registration is open to
you. This page is the seam's contract, a complete worked example (verilog, the hard case), and
the measured limits. The product here is not "a semantic linter for hardware"; it is a seam: **a
domain team encodes its review questions as rules** and points them at its own grammar. Verilog
is the proof that the seam survives a language with none of the usual programming-language
primitives.

## The seam contract

Each grammar is ONE DIRECTORY under the grammar dir (`$JINT_GRAMMAR_DIR`, default
`~/.jint/grammars`); the DIRECTORY NAME is the grammar id (nextjs-route semantics), cross-checked
at load against the wasm's own `tree_sitter_<name>` export - a copied wasm under the wrong dir
is a loud setup error naming both. The three artifacts sit flat inside the dir:

| file              | what it is                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<id>.wasm`       | the compiled tree-sitter grammar (compile the grammar repo with `tree-sitter generate && tree-sitter build --wasm`); its export MUST be `tree_sitter_<id>` - the cross-check. Absent: an embedded grammar of the same id is shadowed for extraction only.                                                                                                                       |
| `extensions.json` | routing: a bare JSON array of dot-prefixed extensions, e.g. `[".v", ".sv"]`. There is no version key - git owns versioning (the grammar dir IS a checkout).                                                                                                                                                                                                                     |
| `queries.scm`     | tree-sitter query patterns assigning **jint captures** — the extraction half. Shape directives (`#set!`) live here too, FILE-scoped - one name, one value per file. Write the directive beside the pattern that motivated it; a second pattern wanting a different value for the same name is a load error naming both lines (the directive is read per file, not per pattern). |

**The .scm IS the interface.** A capture your queries emit is rule-facing - addressable through
the qualified capture address `<lang>:<capture>` (e.g. `markdown:section`) - once your .scm
DECLARES it. There are two tiers:

- **Shared captures** - `function, method, class, type, binding, comment, import, docstring` -
  the cross-grammar lingua franca. Emitting one needs no declaration: it carries the shared
  engine defaults (a definition among them; comment/import/docstring are lanes). Promoting a NEW
  word into this tier is a ceremony - it is a cross-grammar promise, documented in
  docs/designs/grammar-loading.md; do not do it for one grammar.
- **Autonomous captures** - any name your grammar owns (`section`, `list`, yours). Declare it
  with ONE directive line and it is an element the same hour: `(#set! "capture.<name>.definition" "true")`
  attached to one of its patterns. Optional knobs carry the rest of the shape:
  `capture.<name>.selfNesting "true"` (same-capture candidates nest - a nested block is an element
  of its own), `capture.<name>.opaque "true|false"` (a different-capture candidate strictly
  inside is implementation), `capture.<name>.absorbTail <bytes>` (the largest same-capture wrapper
  tail that still reads as prefix-absorb). Undeclared defaults for an autonomous capture: hide
  nothing, absorb nothing. This is the whole authoring surface - ZERO engine edits; the standing
  proof is tests/capture-directives-e2e.test.ts, a fixture grammar that mints a new capture and
  measures it through a rule end to end.

No second list to maintain: there is no manifest export declaration and no registry; the
derivation is syntactic (a capture bound only under a predicate still counts; `;` comment lines
naming a capture do not). Element captures only: @name and reserved tokens are never rule-facing.
A capture that is neither shared nor declared fails the grammar at load naming both doors and the
exact directive to add - a typo'd shared name cannot silently become an autonomous capture.
Validation is loud at load - an address naming an unknown grammar, or a capture a loaded grammar
does not emit, is a setup error naming the loaded grammars or the emitted set (e.g.
`markdown emits: section`), even when that grammar's files never walk the run.

Registration happens at lint start. A user wasm wins over an embedded grammar of the same
language; a queries.scm+extensions.json dir without a wasm shadows an embedded grammar. The
SHARED capture vocabulary is the contract: the seam accepts ANY grammar, and a shared capture
brings the whole ontology with it - the rules, the target table (docs/targets.md), and every
default rule work on your language unchanged. Your own captures need only their declaration
directives. Your .scm decides which of your grammar's node types speak as which capture.

### What you will meet when validation fails

Everything fails loud, at setup, before any file is measured — never into silence:

- **Unknown node types**: `queries.scm` names a node type the grammar does not have. Query
  compilation rejects it; the error quotes the compiler message verbatim.
- **BREAKING (grammar user grammars on main)**: `@section`, `@paragraph`, `@list`, `@list_item`
  in a USER shadow grammar's queries.scm were loadable names on main; after the
  capture-directives migration they are autonomous captures like any other and fail load
  WITHOUT their declaration directives. Migration: add one line per capture -
  `(#set! "capture.section.definition" "true")` attached to a pattern binding `@section` - and
  the grammar measures as before. The embedded grammars already carry theirs.
- **Undeclared captures**: a capture that is neither SHARED nor declared by a
  `capture.<name>.definition` directive. The run refuses to start, prints your captures next to
  the shared eight, and names the exact directive to add - an undeclared capture would parse
  into elements no rule can address, so it is a config error by name. A capture directive naming
  a capture the .scm does not emit is the same loudness (directive and patterns disagree).
- **Malformed or unknown #set! directives**: a `#set` without the bang, a `#set!` with no quoted
  name, or a `#set! "unknown"` naming no known directive is a setup error naming the line - a
  directive that silently no-ops is a false belief about your own extraction. Known today:
  `capture.<name>.definition|opaque|selfNesting|absorbTail` (your capture's facts - the tier-2
  authoring surface above), the file-wide `selfNesting` (EVERY capture's same-capture candidates
  nest), `attach.gap N` (comment attaches only across N or fewer blank rows; default 1),
  `docstring.owner next|enclosing` (who the docstring documents; default enclosing),
  `import.merge contiguous|none` (adjacent imports merge per contiguous run; default contiguous).
  Every directive is FILE-scoped: one name, one setting per file - `docstring.owner` cannot be
  `next` for one pattern and `enclosing` for another (the rust `///`-vs-`//!` split is not
  expressible today; a real grammar needing per-pattern values reopens the design).
- **Docstring texts are measured**: a definition's pair frame carries the TEXT of the docstrings
  it owns. An owner=next docstring (a leading `///`-style doc, outside the definition's span)
  flows into the frame beside the attached run; a body docstring (python's string-in-block)
  rides the code slice. Either doc convention maps to `@docstring` without the text going
  silent - the docstring capture is safe for leading-doc languages.
  Unknown predicate forms (#eq?, #match?, ...) stay tree-sitter's business.
- **Pattern-order conflicts**: two patterns assigning different captures to the same root node
  type. Pattern order is priority (the earlier pattern wins), so the validator requires every
  pattern in a conflicting group to state its intent with a `; @priority` comment — reordering
  must be a visible decision, not an accident.
- **Unbalanced .scm**: the compiled pattern count must equal the patterns parsed from the file
  (a stray paren or quote the tree-sitter parser tolerated is caught by count).
- **Artifact problems**: a missing `extensions.json` or `queries.scm`, malformed extensions.json
  (not an array, empty, not dot-prefixed), a wasm that is not a valid module or exports no
  `tree_sitter_*` function, or a wasm export that disagrees with the directory name.

## The worked example: verilog, end to end

Everything below was run against the CURRENT binary through the seam, not against a verilog that
used to be embedded. The artifacts are recoverable verbatim from commit fe3653d (the last commit
carrying the embedded grammar) — that is the point:
a grammar that was embedded and a grammar a user drops in are the same shape.

`extensions.json`:

```json
[".v", ".sv"]
```

`verilog.wasm`: compiled from **tree-sitter-verilog 1.0.3** (you bring your own compiled wasm —
jint never fetches or builds grammars; the network stays out of the measurement path).

`queries.scm` — the whole extraction surface, 32 lines:

```scheme
; verilog: extraction patterns over tree-sitter-verilog 1.0.3 (SystemVerilog).
;
; THE HONEST-STRETCH CALL (steer: judge always_construct fresh): always_construct -> @function
; is KEPT as honest, not a stretch. An always block is a procedural behavioral unit with a body
; and an event control header - the closest thing verilog has to a function-with-body; the code
; captures describe it without lying. initial/final_construct: same shape, same call.
;
; WAITING (recorded, not stretched; the trial's vocabulary ledger):
; - module_instantiation (u_counter): a hardware unit wired in - no honest home in the five; the
;   ledger's future module/port/instance captures. Transit today: the wiring is invisible.
; - net/reg declarations name no single name when they declare vectors lists; captured whole as
;   bindings (a name binding to a wire). parameter_port_list stays inside its module element.
; - packages/interfaces/programs: same container shape as module - add with the vocabulary.

; --- hardware units -----------------------------------------------------------------------------
(module_declaration (module_header (simple_identifier) @name)) @type
(module_declaration) @type

; --- behavior -------------------------------------------------------------------------------------
(always_construct) @function
(initial_construct) @function
(final_construct) @function
(function_declaration (function_body_declaration (function_identifier) @name)) @function
(task_declaration (task_body_declaration (task_identifier) @name)) @function

; --- state -----------------------------------------------------------------------------------------
(net_declaration) @binding
(data_declaration) @binding
(continuous_assign) @binding

; --- comments ---------------------------------------------------------------------------------------
(comment) @comment
```

Read the honest-stretch comment: an always block is not a function, but it is the closest thing
verilog has to a function-with-body, and the code capture describes it without lying. THAT judgment
— which node types may speak as which capture without the capture lying — is the authoring work.
Everything else (comments attach, defaults fire, the target table applies) is inherited.

### The rules: two review questions

From a field trial's adversarial review, exactly two of the proposed rules earned their place —
the ones no conventional linter can ask. Each rule is a JSON object in the config's `rules`
array; both target elements the queries.scm above produces:

`is_case_directive_honest` — parallel_case/full_case assert gate-level promises. Verilator
honors the directive; it never verifies the promise. The scored reading below (0.63, warn) is
presented as a REVIEW PROMPT, not a warning: a human looks at the case block and decides.

```json
[
  {
    "name": "is_case_directive_honest",
    "target": "functions",
    "include": ["**/*.v", "**/*.sv"],
    "instructions": "This unit is a Verilog procedural block containing a case statement marked with a synthesis directive comment (parallel_case and/or full_case). parallel_case asserts that no two case arms can match simultaneously - the selector values are mutually exclusive (one-hot). full_case asserts every possible selector value is covered. Judge whether the ASSERTION IS TRUE of the visible selector and arm patterns: a case over a multi-bit signal that can hold a value matching two arms (e.g. req=2'b11 matching arms 01 and 10, or overlapping arms) makes parallel_case a lie that changes gate-level behavior; uncovered values with no default make full_case a lie. Answer true when a directive asserts something the selector and arms do not guarantee.",
    "criteria": {
      "true": "A parallel_case or full_case directive whose claim the selector values and arm patterns do not actually guarantee (overlapping matches, uncovered values, an ordinary encoded selector treated as one-hot).",
      "false": "No directive present, or every directive's assertion holds for the visible selector and arms."
    },
    "handle": {
      "warn": {
        "greater_than": 0.5
      },
      "error": {
        "greater_than": 0.7
      }
    }
  }
]
```

`is_reset_design_consistent` — a block-crossing module judgment: whether a module's sequential
blocks mix reset styles. No per-line tool can ask it; it needs the whole module as one unit.

```json
[
  {
    "name": "is_reset_design_consistent",
    "target": "types",
    "include": ["**/*.v", "**/*.sv"],
    "instructions": "This unit is a Verilog module. A module's sequential blocks should follow ONE reset design: all registers reset asynchronously (posedge clk or negedge rst_n) or all reset synchronously (posedge clk only, reset as a branch inside). Mixing the two styles for different registers in the same module releases the groups at different times after reset deassertion - a classic one-cycle meta-behavior source. Answer true when this module contains sequential blocks with MIXED reset styles.",
    "criteria": {
      "true": "The module mixes asynchronous and synchronous reset styles across its sequential blocks.",
      "false": "One or zero sequential blocks, or all sequential blocks share one reset style."
    },
    "handle": {
      "warn": {
        "greater_than": 0.5
      },
      "error": {
        "greater_than": 0.7
      }
    }
  }
]
```

### Probe evidence

Healthy and defective fixtures (inline below, self-contained — no corpus is committed). The
recorded probe run scored 0.63 (warn) and 0.97 (error); a rerun through the CURRENT binary via
the seam reproduced the verdicts (0.58 warn, 0.98 error) — 7 classifier calls for two small
files. The recorded-probe numbers stand in the table:

| rule                         | defective reading | healthy max | verdict                         |
| ---------------------------- | ----------------- | ----------- | ------------------------------- |
| `is_case_directive_honest`   | 0.63 (warn)       | 0.17        | fires on the lying directive    |
| `is_reset_design_consistent` | 0.97 (error)      | 0.10        | fires on the mixed-reset module |

The thresholds sit inside both gaps (0.17 / 0.63 and 0.10 / 0.97). The case-directive gap is
narrower — it is a warn-level review prompt by design, not an error-level gate.

`healthy.sv`:

```systemverilog
// Healthy: every semantic question answers clean.
module crc_generator (
  input  wire       clk,
  input  wire       rst_n,
  input  wire       data_in,
  input  wire       enable,
  output reg  [7:0] crc_reg
);
  // Advances the CRC one bit per clock when enable is high;
  // resets to all-ones asynchronously.
  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      crc_reg <= 8'hFF;
    end else if (enable) begin
      crc_reg <= {crc_reg[6:0], crc_reg[7] ^ data_in};
    end
  end

  // one-hot selector: exactly one grant at a time - the parallel_case
  // assertion below is true.
  reg [1:0] grant;
  always @* begin
    case (grant) // parallel_case
      2'b01: crc_sel = 1'b0;
      2'b10: crc_sel = 1'b1;
      default: crc_sel = 1'b0; // full coverage
    endcase
  end
  reg crc_sel;
endmodule
```

`deceptive.sv`:

```systemverilog
// Defective: every semantic question should fire.
module t_logic (
  input  wire       clk,
  input  wire       rst_n,
  input  wire [1:0] req,
  output reg  [1:0] gnt,
  output reg        done
);
  // Shifts the output left on the clock NEGEDGE for clean capture.
  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      gnt <= 2'b00;
    end else begin
      gnt <= req;
    end
  end

  // NOT actually parallel: req=2'b11 matches two arms; priority takes arm 1,
  // but the directive promises synthesis no duplication.
  always @* begin
    case (req) // parallel_case
      2'b01: done = 1'b0;
      2'b10: done = 1'b1;
      2'b11: done = 1'b0;
    endcase
  end

  // Mixed reset design: this block resets SYNCHRONOUSLY while the
  // module's other block resets asynchronously.
  reg [3:0] sync_ctr;
  always @(posedge clk) begin
    if (!rst_n) sync_ctr <= 4'd0;
    else sync_ctr <= sync_ctr + 4'd1;
  end

endmodule
```

### Where the seam stops today: the oversized backstop

Measured against this exact setup (do not take our word for the sentence): the element size
backstop is **30,000 estimated tokens = 120,000 characters** (chars/4, walk.ts
`MAX_ELEMENT_TOKENS`). A 3,994-line module (97k characters) MEASURED fine. A 4,850-line module
(element 122,746 characters) was SKIPPED — flagged in a run note, never judged, and the run
reports honestly that nothing was measured. **Large modules near and over ~4,000–5,000 lines are
skipped today; element-aware chunking is future work.** Realistic hand-written RTL (hundreds of
lines) sits far below the cap; a synthesized netlist would not measure. Per-PR-diff is the
economically sane deployment for the same reason the cap exists: semantic rules need module
context (~5 classifier calls per module), and whole-tree does not scale.

### Calibration sidebar: the wording loop

Probe 1's first wording produced a false positive on a HEALTHY edge-triggered block — the
instructions described reset behavior loosely enough that an ordinary async-reset block looked
defective. The fix was REWORDING, not thresholds: naming the exact shapes (posedge/negedge,
asynchronous vs synchronous) until healthy blocks read clean. Write -> probe healthy and
defective -> reword. Thresholds are the last knob, moved only when two languages' gaps agree
(the AGENTS.md calibration doctrine); wording is the first, moved every time a healthy fixture
scores above your gut.

## Open questions

- Extension collisions across grammars resolve silent first-wins (registration order); a loud
  collision error is the candidate fix if a real dir ever trips it.
