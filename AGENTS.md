# jint

jint (jev lint) measures code with AI-classifier judgments (TypeSafe System One / jev) and turns raw readings into actionable output via user-configurable callbacks. Sensors in, signals out.

## Design

CLI -> SDK -> jev; config is a single small typed file. The CLI is a thin client of the SDK — every CLI capability must exist as an SDK option first; nothing is CLI-only.

### Adding defaults

A rule is not promoted to the default set from one corpus: single-language calibration overfits that language's naming and structure conventions.

- Probe on at least two languages before promotion: a healthy corpus plus defective fixtures per language.
- Document the healthy-max / defective-min gap for each language; thresholds must sit inside every measured gap.
- Validate that the rule's claim survives each language's conventions (naming style, file/package layout) rather than only its syntax.
- Precedent: is_filename_fitting (issue 006) — TS probe 0.36/0.88, Go probe 0.25/0.72 (cobra + lying-name fixtures), verb-name and package-per-dir conventions checked before promotion.

## Glossary

Glossary (GLOSSARY.md) is a constraint to maintain, not reference material: no new term may be
coined unless necessary. Before introducing a term, check the glossary for an existing one; broad
terminology leads to entropy - two names for one concept, or one name for two, is drift that every
future contributor and agent pays for. When a new term is truly needed, define it in the glossary
at the moment it is coined, not after.

## Testing

Unit tests are colocated next to the source they test (src/**/*.test.ts). The root tests/ directory holds only end-to-end/integration tests (process-spawning, e.g. the CLI binary) and shared helpers. Shared fixtures live in tests/fixtures/; single-consumer fixtures live next to their test. Run: bun test --parallel.
