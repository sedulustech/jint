# jint

jint is an AI-classifier lint tool: it measures code with classifier judgments (asked of a provider) and turns raw readings into actionable output via user-configurable callbacks. Sensors in, signals out.

## Design

CLI -> SDK -> provider; config is a single small typed file. The CLI is a thin client of the SDK — every CLI capability must exist as an SDK option first; nothing is CLI-only.

### Adding defaults

A rule is not promoted to the default set from one corpus: single-language calibration overfits that language's naming and structure conventions.

- Test small on many languages, not big on a couple: a sample of real units per language. A language's conventions show in a few units; another hundred units of the same language add little.
- Calibrate only on real code: agent-generated code from benchmarks, or existing open-source software. Never on fixtures written for the rule - they match the criteria by construction and prove nothing. Label a sample of the readings by hand: reruns show stability, only labels show correctness.
- Document the healthy-max / defective-min gap for each language; thresholds must sit inside every measured gap.
- Validate that the rule's claim survives each language's conventions (naming style, file/package layout) rather than only its syntax.
- Precedent: is_filename_fitting (issue 006) — TS test 0.36/0.88, Go test 0.25/0.72 (cobra plus fixtures, before fixtures were ruled out), verb-name and package-per-dir conventions checked before promotion.

## Capture behavior

Capture behavior lives in grammars, never in the engine: a capture's facts (is it an element,
what it hides, how it nests) are `#set! "capture.<name>.<knob>"` directives in the owning
grammar's queries.scm. The engine holds per-capture facts in exactly one place - the shared
capture contract (packages/sdk/src/core/grammars/shared.ts), the lingua franca's defaults - and
promoting a word into the shared tier is the only ceremony; a grammar's own capture needs one
.scm line. The guard test (capture-facts.guard.test.ts) fails the suite if a capture-keyed
table appears anywhere else, and tests/capture-directives-e2e.test.ts keeps the open path
proven - edit a .scm before you edit the engine.

## UI

Styles are declared at the component (Tailwind, shadcn): declaration, behavior, and state live
in one place — they are coupled in the UX, and rule-matching elsewhere is a second style
authority that makes the components invisible and unmaintainable. No global element or
data-attribute selectors for component behavior (button:not(:disabled), [data-slot="button"]).
Globals are for shared values only: the palette + spacing tokens in @theme, base document
styles (body), non-behavioral resets.

Button variants are a vocabulary, not a per-instance choice: all action buttons use the
`secondary` variant; `default` (solid) stays in the map reserved for a severity story, as do
the other variants (outline, ghost, destructive, disabled). State (pressed, unpressed, hover,
loading) is a token-based state treatment on the same variant, never a different variant; the
disabled look is the `disabled` variant's tokens — identical whether reached via the variant
or the disabled attribute — not an opacity hack.

## Glossary

Glossary (GLOSSARY.md) is a constraint to maintain, not reference material: no new term may be
coined unless necessary. Before introducing a term, check the glossary for an existing one; broad
terminology leads to entropy - two names for one concept, or one name for two, is drift that every
future contributor and agent pays for. When a new term is truly needed, define it in the glossary
at the moment it is coined, not after.

## Releasing

Releases follow RELEASING.md: a tag push builds and attaches binaries to a DRAFT release; a
human edits the notes and presses Publish. Never publish on a merge, never create a release
that skips the draft. The workflow files are the only home for pins and triggers - RELEASING.md
stays stateless.

## Testing

Unit tests are colocated next to the source they test (src/**/*.test.ts). The root tests/ directory holds only end-to-end/integration tests (process-spawning, e.g. the CLI binary) and shared helpers. Shared fixtures live in tests/fixtures/; single-consumer fixtures live next to their test. Run: bun test --parallel.
Browser tests locate controls structurally - role, aria-label, data-testid, aria-controls -
never by rendered text: copy changes, structure is the contract. Text assertions are for data
values, and anchor in a structural container.

## Issues

Issues are drafted in the house format and opened with the `draft` label; a maintainer
promotes by removing the label. The label is the only draft marker - no `Status:` line
in the body.

Bodies are written in Simplified Technical English: sentences under 20 words, active
voice, one idea per sentence, the same word for the same thing, exact numbers.

Titles follow `package(scope): concise description` - package is the surface (`cli`, `sdk`,
`ui`, `docs`, etc), scope is the kind of work (`dx`, `bug`, `feat`). Examples:
`cli(dx): add noun to rerun a specific classification`, `sdk(dx): add way to see cost of a run`.

Section order:

- **What** - 2-3 sentences. The contract violation, readable with zero context.
- **Repro** — preferred; the rule, not the exception. Command or steps, config, actual
  output, exact numbers. Evidence, not adjectives. Name the branch or worktree. Omit only
  where no repro can exist (a capability that does not exist).
- **Cause** - only if known; otherwise omit, or write "The cause is unknown."
- **Proposal** - only if one exists. The behavioral change, scope, test impact.
- **Screenshot** - only for UI-rendering issues. Crop to the defect.

Conditional sections are omitted, never written as "n/a." A diagram benefits What when it describes the problem better.

`.github/ISSUE_TEMPLATE/1-draft.yml` enforces this structure for humans.
