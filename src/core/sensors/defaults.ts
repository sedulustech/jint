/**
 * The five default sensors, shipped visible and overridable.
 *
 * Descriptions are the exact calibrated claims from tmp/diff-v4 (the validated
 * judgment task), so the numbers transfer. measure.ts compiles each into a noul
 * question with the validated structured envelope:
 *   { role: "measurement", dimension, claim, true_means }
 *
 * Default handles are published per sensor with correct polarity, thresholds
 * anchored to the calibration data (tmp/diff-v4/diff_v4_perfile.json healthy
 * baselines must yield ZERO signals; diff_v4_sensitivity.json mutants must be
 * caught):
 *
 *   sensor                  polarity   healthy range   mutants
 *   naming_precision        high=good  0.54 - 0.78     m1_bad_names 0.15 (error), m4_obfuscate 0.42 (warn)
 *   naming_consistency      high=good  0.89 - 0.90     m1_bad_names 0.43 (error), m4_obfuscate 0.59 (warn)
 *   greppable_identifiers   high=good  0.56 - 0.64     m1_bad_names 0.46 (warn)
 *   excessive_comments      high=bad   0.10 - 0.28     m3_comment_bloat 0.80 (error)
 *   cognitive_complexity    high=bad   0.18 - 0.40     m4_obfuscate 0.48 (warn), m3_comment_bloat 0.42 (warn)
 *
 * Override a handle by re-declaring the sensor by name in config:
 *   sensors: { ...sensors.defaults, naming_precision: { ...sensors.defaults.naming_precision, handle: v => v < 0.5 ? "error" : null } }
 */

import type { Sensor } from "../types.ts";

export const naming_precision: Sensor = {
  name: "naming_precision",
  description:
    "From each new identifier name alone, it is easy to infer what it does or holds (the name states purpose, not implementation).",
  inputTypes: ["file", "diff"],
  handle: (v) => (v < 0.4 ? "error" : v < 0.5 ? "warn" : null),
};

export const naming_consistency: Sensor = {
  name: "naming_consistency",
  description:
    "New identifiers are consistent with each other and with the names this change touches: same concept keeps the same word, same role keeps the same suffix/verb convention.",
  inputTypes: ["file", "diff"],
  handle: (v) => (v < 0.7 ? "error" : v < 0.85 ? "warn" : null),
};

export const greppable_identifiers: Sensor = {
  name: "greppable_identifiers",
  description:
    "Each new identifier is distinctive enough that a text search finds it precisely; bad greps break discovery by text for both humans and agents.",
  inputTypes: ["file", "diff"],
  handle: (v) => (v < 0.45 ? "error" : v < 0.55 ? "warn" : null),
};

export const excessive_comments: Sensor = {
  name: "excessive_comments",
  description:
    "This diff carries too many comments: comments that narrate what the code plainly does, restate the name, or annotate the obvious.",
  inputTypes: ["file", "diff"],
  handle: (v) => (v > 0.6 ? "error" : v > 0.45 ? "warn" : null),
};

export const cognitive_complexity: Sensor = {
  name: "cognitive_complexity",
  description:
    "The added code is cognitively complex: nesting, mixed concerns in one unit, state that must be held in mind, interruption of linear reading - hard to UNDERSTAND.",
  inputTypes: ["file", "diff"],
  handle: (v) => (v > 0.6 ? "error" : v > 0.45 ? "warn" : null),
};

/** All default sensors by name — the `sensors.defaults` of the config surface. */
export const sensorDefaults: Record<string, Sensor> = Object.freeze({
  naming_precision,
  naming_consistency,
  greppable_identifiers,
  excessive_comments,
  cognitive_complexity,
});
