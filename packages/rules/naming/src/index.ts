/**
 * Naming rules: one vocabulary, one casing convention, searchable identifiers, file names that
 * match their bodies.
 */

import type { RuleSchema, NoulRuleSchema } from "@jint/contract";

export const is_vocabulary_consistent: NoulRuleSchema = {
  name: "is_vocabulary_consistent",
  instructions:
    "Do the identifiers in this change keep one vocabulary - the same concept always the same word?",
  criteria: {
    true: "The new identifiers in this change keep one vocabulary with each other and with the names the change touches: the same concept always keeps the same word, and the same role keeps the same suffix or verb convention.",
    false:
      "Synonym drift is present: the same concept is referred to by two different words within the same change (user in one place, account for the same thing in another; cart versus basket), forcing a reader to learn two names for one idea. Different words for genuinely different concepts are not drift.",
  },
  target: "files",
  handle: { warn: { less_than: 0.75 }, error: { less_than: 0.6 } },
};

export const is_naming_convention_consistent: NoulRuleSchema = {
  name: "is_naming_convention_consistent",
  instructions: "Do identifiers of the same kind in this file follow a single casing convention?",
  criteria: {
    true: "Identifiers of the same kind follow one casing convention.",
    false:
      "Two different casing forms appear for the same kind within the file (getUserData beside fetch_user_data for two functions, OrderItem beside order_item for two types), forcing a reader to learn two shapes for one kind. Different kinds may use different conventions, and word choice or name quality are not casing failures.",
  },
  // A file, not an element: casing consistency is a comparison, and one element rarely holds
  // two identifiers of the same kind to compare.
  target: "files",
  handle: { warn: { less_than: 0.75 }, error: { less_than: 0.65 } },
};

/**
 * Promoted from the filename-fit probe (tmp/filename-fit.config.json, issue 006) after a
 * two-language calibration: healthy max 0.33 (Go, cobra) / 0.36 (TS, jint src/) against defective
 * min 0.60 / 0.88 - thresholds sit mid-gap on both. Element rules cannot see the path, so this is
 * the only rule that can catch "json.ts whose body renders HTML reports".
 *
 * Named for the defect it measures: the value is the probability that the name promises a subject
 * the body does not deliver, so a high value is bad. It was is_filename_fitting; a positive name
 * with a high-is-bad value read backwards, and rewording the question as "does the name fit" lost
 * the mismatches (the model leans yes), so the question stays the defect and the name follows it.
 */
export const has_filename_mismatch: NoulRuleSchema = {
  name: "has_filename_mismatch",
  instructions:
    "Does this file's name promise a subject its body does not deliver - a name whose dominant content answers to a different responsibility?",
  criteria: {
    true: "The file name promises one subject but the body delivers a different one: the dominant content of the file - its main exports and the logic around them - belongs to a subject the name does not name or names differently (json.ts whose body renders HTML reports, walker.ts whose body parses config files). Judge the basename of the state path, using the directory path only for context; a name may state a role or verb (load, parse, classify, render) and then matches a body whose dominant action is that verb. Judge by the dominant responsibility, not incidental helpers: a small shared helper inside the file is not a mismatch. Generic names (utils, helpers, types, common, index) are exempt from being called too broad, but if a generic name hides one specific subject and the body contradicts that subject, that is a mismatch. Barrel files that only re-export, and test files, are exempt unless they contradict their name.",
    false:
      "The file name and the body agree: the name names the subject of the main exports, or states the verb/role the body's dominant action performs, or the name is a deliberate generic (utils, helpers, types, index) whose body is ordinary mixed helpers, or the file is a barrel/test file consistent with its name. A name being merely vague or the code being poorly written is not this defect: answer false.",
  },
  target: "files",
  handle: { warn: { greater_than: 0.55 }, error: { greater_than: 0.75 } },
};

export const is_greppable: NoulRuleSchema = {
  name: "is_greppable",
  instructions:
    "Are the identifiers in this function searchable with terms a developer would use to find this code?",
  criteria: {
    true: "The code identifiers judged here are those in the function's declaration and body - its own name, its parameters, its locals, and the names it reads - and they are greppable: written out in full at every occurrence, never split into fragments or dynamically constructed from pieces, never renamed at a boundary, and specific enough that a search hit is genuinely a reference to this thing.",
    false:
      "At least one identifier in the function cannot be found by a single search: it is split into fragments or dynamically constructed from pieces, renamed at a boundary so the same concept needs two search strings, or is a bare word (data, handler, util) whose hits are mostly noise. CLI flag spellings, help text, and log messages are user-facing interface, not code identifiers, and are outside this rule.",
  },
  target: "functions",
  handle: { warn: { less_than: 0.75 }, error: { less_than: 0.6 } },
};

/** Every rule of this domain, in run order. */
export const rules: readonly RuleSchema[] = Object.freeze([
  is_vocabulary_consistent,
  is_naming_convention_consistent,
  is_greppable,
  has_filename_mismatch,
]);
