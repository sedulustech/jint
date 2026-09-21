/**
 * The eight default sensors, each shipping a visible, overridable handle.
 * One sensor measures one thing (tmp/design.md, "Default sensors"); the comment family
 * replaced excessive_comments (retired - a superset of attributes that move
 * in opposite directions averages its own signal into noise).
 *
 * Each description is the exact calibrated claim compiled by measure.ts into
 * the noul question's structured measurement envelope:
 *   { role: "measurement", dimension, claim, true_means }
 *
 * Default handles: polarity per sensor, thresholds anchored to the diff-v4
 * calibration baselines (healthy runs must produce zero signals; the m3
 * bloat mutant is caught by is_comment_narration on per-file units):
 *
 *   sensor                            polarity    error    warn     healthy range
 *   naming_precision                  high = good < 0.4    < 0.5    0.54 - 0.78
 *   naming_consistency                high = good < 0.7    < 0.85   0.89 - 0.90
 *   greppable_identifiers             high = good < 0.60   < 0.75   0.65 - 0.90
 *   is_comment_business_context       high = good null in v0   0.32 - 0.86 (absence is not a defect)
 *   is_comment_narration              high = bad  > 0.45   > 0.30   0.09 - 0.19
 *   is_comment_patching_readability   high = bad  > 0.55   > 0.40   0.11 - 0.20
 *   will_comment_drift                high = bad  > 0.7    > 0.55   0.16 - 0.43
 *   cognitive_complexity              high = bad  > 0.6    > 0.45   0.18 - 0.40
 *
 * Override a handle by re-declaring the sensor by name in config:
 *   sensors: { ...sensors.defaults, naming_precision: { ...sensors.defaults.naming_precision, handle: (value) => (value < 0.5 ? "error" : null) } }
 */

import type { Sensor } from "../types.ts";

export const naming_precision: Sensor = {
  name: "naming_precision",
  description:
    "From each new identifier name alone, it is easy to infer what it does or holds (the name states purpose, not implementation).",
  inputTypes: ["file", "diff"],
  handle: (value) => (value < 0.4 ? "error" : value < 0.5 ? "warn" : null),
};

export const naming_consistency: Sensor = {
  name: "naming_consistency",
  description:
    "New identifiers are consistent with each other and with the names this change touches: same concept keeps the same word, same role keeps the same suffix/verb convention.",
  inputTypes: ["file", "diff"],
  handle: (value) => (value < 0.7 ? "error" : value < 0.85 ? "warn" : null),
};

export const greppable_identifiers: Sensor = {
  name: "greppable_identifiers",
  description:
    "The identifiers in this code - the names of functions, variables, types, constants, and exported symbols - are greppable: a maintainer who knows a thing by its name can find every place it is used by searching that name. This means identifiers are written out in full at every occurrence, never split into fragments or dynamically constructed from pieces, never renamed at a boundary so the same concept requires two different search strings, and specific enough (not bare words like data, handler, or util) that a search hit is genuinely a reference to this thing. Strings that are user-facing interface rather than code identifiers - CLI flag spellings, help text, log messages - are not part of this judgment; only code identifiers are.",
  inputTypes: ["file", "diff"],
  handle: (value) => (value < 0.60 ? "error" : value < 0.75 ? "warn" : null),
};

export const is_comment_business_context: Sensor = {
  name: "is_comment_business_context",
  description:
    "The comments in this code carry business context: they explain why the code exists or why this approach was chosen - the requirement, constraint, or decision the code serves, a pointer to where that decision lives (ticket, spec, incident, upstream contract), or a warning that the code must stay consistent with something outside itself. The claim is about knowledge a maintainer cannot recover from the code alone. Comments that describe what the code does, docstrings that restate a signature, or style notes are not business context.",
  inputTypes: ["file", "diff"],
  // Null in v0, deliberately: high readings are a virtue and low readings are
  // not a defect (not all code needs recorded context), so no reading is
  // evidence of a problem - any threshold would flag healthy code. The
  // measurement still streams; enforce context requirements by overriding this
  // handle in config.
  handle: () => null,
};

export const is_comment_narration: Sensor = {
  name: "is_comment_narration",
  description:
    "The comments in this code narrate: they merely restate what the code already says - translating statements into prose, echoing the identifier's own name, or annotating the obvious (an increment, an assignment, a return). The comment is duplicate information; removing it loses nothing a reader could not get from the code itself. Comments that state why the code exists, record a constraint, or flag a non-obvious trap say what the code cannot and are not narration.",
  inputTypes: ["file", "diff"],
  handle: (value) => (value > 0.45 ? "error" : value > 0.30 ? "warn" : null),
};

export const is_comment_patching_readability: Sensor = {
  name: "is_comment_patching_readability",
  description:
    "The comments in this code patch for readability: they exist to explain code that should read itself, compensating for confusing code - dense expressions, tangled control flow, misleading names - with prose instead of the code being made readable. This is a code smell: the fix is rewriting the code, and the comment makes the confusion livable so the rewrite never happens. Comments that add what code cannot carry - rationale, constraints, external contracts - are not readability patches, even when the surrounding code is also hard to read.",
  inputTypes: ["file", "diff"],
  handle: (value) => (value > 0.55 ? "error" : value > 0.40 ? "warn" : null),
};

export const will_comment_drift: Sensor = {
  name: "will_comment_drift",
  description:
    "The comments in this code are drift-prone: they pin specific artifacts by name - files, functions, parameters, constants, types, paths - such that renaming or removing that artifact silently invalidates the comment while the code keeps working. The claim is coupling between the comment's wording and specific identifiers, not comments that are already wrong today. Comments that describe behavior, rationale, or constraints without naming specific artifacts cannot drift this way.",
  inputTypes: ["file", "diff"],
  // Anchored above the healthy distribution on purpose: comments that pin
  // artifact names are common in healthy code (keys.ts reads 0.41), so the
  // bar for "this is a drift problem" sits at strong assertions only.
  handle: (value) => (value > 0.7 ? "error" : value > 0.55 ? "warn" : null),
};

export const cognitive_complexity: Sensor = {
  name: "cognitive_complexity",
  description:
    "The added code is cognitively complex: nesting, mixed concerns in one unit, state that must be held in mind, interruption of linear reading - hard to UNDERSTAND.",
  inputTypes: ["file", "diff"],
  handle: (value) => (value > 0.6 ? "error" : value > 0.45 ? "warn" : null),
};

/** All default sensors by name — the `sensors.defaults` record of the config surface. */
export const sensorDefaults: Record<string, Sensor> = Object.freeze({
  naming_precision,
  naming_consistency,
  greppable_identifiers,
  is_comment_business_context,
  is_comment_narration,
  is_comment_patching_readability,
  will_comment_drift,
  cognitive_complexity,
});
