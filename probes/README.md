# probes

Archive of one-shot calibration probes and their fixture corpora — **preserved as
history, not as load-bearing configs**. This is data of how the tool evolved: the
criteria wording, threshold choices, and schema shapes are snapshots of their time.

## What's here

`*.config.json` — one probe run each. Naming maps to the question being probed
(`is-readable-*`, `name-shape-*`, `choice-probe`, `dogfood`, ...).

Corpora — the defective/healthy fixtures a probe measured:

- `def-corpus/` — defective TS fixtures
- `name-def-{ts,go}/` — naming-defect fixtures (TS + Go, the two-language probes)
- `read-def/`, `read-def-go/` — readability-defect fixtures
- `my-probe/` — first attempt at the probe format (kept for the shape's evolution)

The Sep-24-era probes (`debug-actionability`, `seam-purity`) also carry their
`.report.json` / `.stderr.log` / `.wire.log` outputs, the full probe record.

## Reading these

- **Several configs use dead schema shapes.** The handler schema moved from
  `fires_when`/`warn_at` to the discriminated `handle.map` (score) and
  `handle.{warn,error}.{less_than,greater_than}` (noul) forms during the
  choice/score work (2026-09). A stale config fails `CONFIG_INVALID` today —
  that is expected; it is evidence of the old contract, not a bug.
- Calibration conclusions live in `tmp/designs/` (e.g.
  `is-cognitively-complex-rebuild.md`, `score-resolver.md`) and the issues
  ledger (`tmp/issues/`). The probe is the raw measurement; the design doc is
  the interpretation.
- Rule defaults that graduated from a probe are in `src/core/sensors/defaults.ts`.

## Conventions

- New one-shot probes go here, named `<question>-probe.config.json` — or
  <evolution-question>-probe.config.json when the naming-defect pattern needs a
  purpose prefix. Fixtures live alongside (`<question>-def-<lang>/`).
- This dir is **tracked**: probes are data, and data survives. Scratch that is
  not data belongs in `tmp/` (gitignored).
