/**
 * The five default sensors, each shipping a visible, overridable handle.
 *
 * Each description is the exact calibrated claim from tmp/diff-v4 (the
 * validated judgment task), so the measurements transfer. measure.ts compiles
 * each claim into the measurement — the raw noul value from jev for
 * (sensor, input) — with the validated structured measurement envelope:
 *   { role: "measurement", dimension, claim, true_means }
 *
 * Each default handle reads the value and decides the severity: polarity per
 * sensor, error/warn thresholds anchored to the diff-v4 calibration baselines
 * (diff_v4_perfile.json healthy runs must produce zero signals):
 *
 *   sensor                  polarity    error    warn     healthy range
 *   naming_precision        high = good < 0.4    < 0.5    0.54 - 0.78
 *   naming_consistency      high = good < 0.7    < 0.85   0.89 - 0.90
 *   greppable_identifiers   high = good < 0.60   < 0.75   0.65 - 0.90
 *   excessive_comments      high = bad  > 0.6    > 0.45   0.10 - 0.28
 *   cognitive_complexity    high = bad  > 0.6    > 0.45   0.18 - 0.40
 *
 * The diff_v4_sensitivity.json calibration mutants (bad names, comment bloat, obfuscation) must be caught:
 *   m1_bad_names       naming_precision (error), naming_consistency (error), greppable_identifiers (warn)
 *   m3_comment_bloat   excessive_comments (error)
 *   m4_obfuscate       naming_precision (warn), naming_consistency (warn), cognitive_complexity (warn)
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

export const excessive_comments: Sensor = {
  name: "excessive_comments",
  description:
    "This diff carries too many comments: comments that narrate what the code plainly does, restate the name, or annotate the obvious.",
  inputTypes: ["file", "diff"],
  handle: (value) => (value > 0.6 ? "error" : value > 0.45 ? "warn" : null),
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
  excessive_comments,
  cognitive_complexity,
});
