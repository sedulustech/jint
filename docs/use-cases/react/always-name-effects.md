---
title: "Use case: always name React effects"
description: "Build and calibrate a rule from a team convention: effects named for what they do. The question, the controls, the readings, and the limits of the unit."
sidebar:
  label: Always name effects
---

# Use case: always name React effects

A syntax check cannot enforce this convention: every `useEffect` gets a function named for what the
effect does. `useEffect(function syncDocumentTitle() {...})` reads better than an anonymous arrow.
A name that is hard to write is a sign the effect does too much.

Whether a name says what the body does is a judgment, so it is a rule. It ships as
`is_effect_named` in `jint:rules/react/hooks`.

```ts
import { is_effect_named } from "jint:rules/react/hooks";

export default { rules: { use: [is_effect_named] } };
```

## The question

The rule asks whether every effect hook call in a function passes a named function whose name says
what the effect does.

- **Yes:** the function calls no effect hook, or every effect gets a named function, or a
  reference to one, whose name states the purpose (`syncDocumentTitle`).
- **No:** an effect gets an anonymous arrow, a name with no purpose (`effect`, `onMount`), or a name
  for a different job than the body does. An effect that does two things is not this defect. The
  rule judges the name, not the design.

A high reading is good, so the handle warns below 0.6 and errors below 0.3.

## The controls

A control is a small file with a known answer. Seven cover the question:

| control                                            | reading |
| -------------------------------------------------- | ------- |
| named function expressions                         | 1.00    |
| a named function passed by reference               | 1.00    |
| a component with no effect                         | 1.00    |
| two jobs in one name (`loadDashboardAndTrackView`) | 0.96    |
| anonymous arrows                                   | 0.00    |
| generic names (`effect`, `onMount`)                | 0.00    |
| a name for the wrong job (`fetchUser` on a resize) | 0.04    |

The defective controls read at most 0.04 and the healthy ones at least 0.96. The thresholds sit
inside that gap. The two-jobs control reads as named well, because its name states a purpose.

## A real codebase

On one React codebase's `components` directory, jint measured 543 functions. Twenty call an effect
hook, and all twenty read below 0.3. No function without an effect fired. That codebase passes no
named function expression to any of its 75 effect calls, so the rule fires on every component that
has one.

## Limits

- **The unit is the function.** An effect call is not an element of its own, so a component with
  three effects gets one reading.
- **TSX only.** The rule's `include` is `**/*.tsx`, the files the calibration covered.
- **The path stays out.** The rule does not set `includePath`, so a component reads the same wherever
  the file sits.

To change what the rule judges, copy it into your config and edit the question. See
[Calibration](../../calibration.md).
