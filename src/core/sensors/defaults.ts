/**
 * The eight default sensors, each shipping a visible, overridable handle; one sensor measures one
 * attribute. The comment family replaced the retired excessive_comments, whose attributes moved in
 * opposite directions and averaged the aggregate signal into noise.
 *
 * Sensor names follow TypeSafe's proposition convention (is_/will_ prefix): each sensor compiles to
 * exactly one noul question, so its name reads as the yes/no claim the question asks.
 *
 * Each description is the exact claim the measure step compiles into the question envelope: editing
 * a description is a re-calibration event, since thresholds are anchored to readings taken under
 * the claim text.
 *
 * Handle policy: a healthy run never errors; warns are legitimate nudges. High=good sensors error
 * below the healthy floor, high=bad sensors above the healthy ceiling, anchored on the self-lint
 * corpus with the sibling-repo calibration fixtures as the external check. Current thresholds and
 * healthy ranges are documented in the README, next to the override examples.
 */

import type { Sensor } from "../types.ts";

export const isNamePurposeful: Sensor = {
  name: "is_name_purposeful",
  description: `
     Each new identifier's name states what it does or holds, judged from the name alone: a reader should be able to infer the thing's purpose without reading the code around it.
     The failure modes: names that reveal implementation instead of purpose (naming how it works, not what it is for), bare generic words that could label anything (data, handler, util, temp), and names that mislead - promising behavior or a kind the thing does not have.
     The claim is about what the name communicates; casing and convention style are not naming failures.
   `,
  inputTypes: ["file", "diff"],
  granularity: "definition",
  handle: (value) => (value < 0.5 ? "error" : value < 0.6 ? "warn" : null),
};

export const isVocabularyConsistent: Sensor = {
  name: "is_vocabulary_consistent",
  description: `
     New identifiers keep one vocabulary with each other and with the names this change touches: the same concept keeps the same word, and the same role keeps the same suffix or verb convention.
     The boundary failure is synonym drift: the same concept referred to by two different words within the same change (user in one place, account for the same thing in another; cart versus basket), forcing a reader to learn two names for one idea.
     Different words for genuinely different concepts are consistent; only same-concept drift is the failure.
   `,
  inputTypes: ["file", "diff"],
  granularity: "file",
  handle: (value) => (value < 0.6 ? "error" : value < 0.75 ? "warn" : null),
};

export const isNamingConventionConsistent: Sensor = {
  name: "is_naming_convention_consistent",
  description: `
     Identifiers of the same kind follow one casing convention: functions and variables in camelCase, types and classes in PascalCase, module-level constants in SCREAMING_SNAKE.
     Each kind follows the convention the surrounding code already establishes, so a module that has settled on a different dominant form is judged against that form.
     The failure is two forms for one kind within the same change or module: getUserData beside fetch_user_data for two functions, OrderItem beside order_item for two types - forcing a reader to learn two shapes for one kind.
     Different kinds may use different conventions; casing is about form alone - word choice and name quality are other claims' territory.
   `,
  inputTypes: ["file", "diff"],
  granularity: "definition",
  // Error line sits in the self-corpus gap (0.56 -> 0.67) between the blatant
  // convention mixers and the consistent files; the clean corpus (mobius
  // 0.89-0.91) clears it by 0.24, and m1_bad_names (0.61) errors with it.
  handle: (value) => (value < 0.65 ? "error" : value < 0.85 ? "warn" : null),
};

export const isGreppable: Sensor = {
  name: "is_greppable",
  description: `
     The identifiers in this code - the names of functions, variables, types, constants, and exported symbols - are greppable: a maintainer who knows a thing by its name can find every place it is used by searching that name.
     This means identifiers are written out in full at every occurrence, never split into fragments or dynamically constructed from pieces, never renamed at a boundary so the same concept requires two different search strings, and specific enough (not bare words like data, handler, or util) that a search hit is genuinely a reference to this thing.
     Strings that are user-facing interface rather than code identifiers - CLI flag spellings, help text, log messages - are not part of this judgment; only code identifiers are.
   `,
  inputTypes: ["file", "diff"],
  granularity: "file",
  handle: (value) => (value < 0.6 ? "error" : value < 0.75 ? "warn" : null),
};

export const is_comment_business_context: Sensor = {
  name: "is_comment_business_context",
  description: `
     The comments in this code carry business context: they explain why the code exists or why this approach was chosen - the requirement, constraint, or decision the code serves, a pointer to where that decision lives (ticket, spec, incident, upstream contract), or a warning that the code must stay consistent with something outside itself.
     The claim is about knowledge a maintainer cannot recover from the code alone.
     Comments that describe what the code does, docstrings that restate a signature, or style notes are not business context.
   `,
  inputTypes: ["file", "diff"],
  granularity: "comment",
  // Null in v0, deliberately: high readings are a virtue and low readings are
  // not a defect (not all code needs recorded context), so no reading is
  // evidence of a problem - any threshold would flag healthy code. The
  // measurement still streams; enforce context requirements by overriding this
  // handle in config.
  handle: () => null,
};

export const is_comment_narration: Sensor = {
  name: "is_comment_narration",
  description: `
     The comments in this code narrate: they merely restate what the code already says - translating statements into prose, echoing the identifier's own name, or annotating the obvious (an increment, an assignment, a return).
     The comment is duplicate information; removing it loses nothing a reader could not get from the code itself.
     Comments that state why the code exists, record a constraint, or flag a non-obvious trap say what the code cannot and are not narration.
   `,
  inputTypes: ["file", "diff"],
  granularity: "comment",
  handle: (value) => (value > 0.45 ? "error" : value > 0.3 ? "warn" : null),
};

export const is_comment_patching_readability: Sensor = {
  name: "is_comment_patching_readability",
  description: `
     The comments in this code patch for readability: they exist to explain code that should read itself, compensating for confusing code - dense expressions, tangled control flow, misleading names - with prose instead of the code being made readable.
     This is a code smell: the fix is rewriting the code, and the comment makes the confusion livable so the rewrite never happens.
     Comments that add what code cannot carry - rationale, constraints, external contracts - are not readability patches, even when the surrounding code is also hard to read.
   `,
  inputTypes: ["file", "diff"],
  granularity: "comment",
  handle: (value) => (value > 0.55 ? "error" : value > 0.4 ? "warn" : null),
};

export const will_comment_drift: Sensor = {
  name: "will_comment_drift",
  description: `
     The comments in this code are drift-prone: they pin specific artifacts by name - files, functions, parameters, constants, types, paths - such that renaming or removing that artifact silently invalidates the comment while the code keeps working.
     The claim is coupling between the comment's wording and specific identifiers, not comments that are already wrong today.
     Comments that describe behavior, rationale, or constraints without naming specific artifacts cannot drift this way.
   `,
  inputTypes: ["file", "diff"],
  granularity: "comment",
  // Anchored above the healthy distribution on purpose: comments that pin
  // artifact names are common in healthy code, so the bar sits at strong
  // assertions only.
  handle: (value) => (value > 0.7 ? "error" : value > 0.55 ? "warn" : null),
};

export const isCognitivelyComplex: Sensor = {
  name: "is_cognitively_complex",
  description: `
     The added code carries accidental complexity: difficulty the author could reduce without changing what the code does.
     The failure modes: nesting so deep the reader must track a stack of conditions, several unrelated concerns mixed into one unit, state the reader must hold in mind across lines to know what is happening, and a non-linear reading order that forces jumping around instead of flowing top to bottom.
     Complexity inherent to the problem - cases that genuinely exist, data the domain itself forces - is excluded: the claim is about avoidable difficulty in how the solution is written, not unavoidable difficulty in the problem.
   `,
  inputTypes: ["file", "diff"],
  granularity: "definition",
  // Thresholds kept from the previous anchor: the scoped claim lowered the
  // healthy ceiling on both calibration corpora, widening the margin to the
  // bloat/obfuscate mutants, which land in the warn band.
  handle: (value) => (value > 0.6 ? "error" : value > 0.45 ? "warn" : null),
};

/** All default sensors by name — the `sensors.defaults` record of the config surface. */
export const sensorDefaults: Record<string, Sensor> = Object.freeze({
  is_name_purposeful: isNamePurposeful,
  is_vocabulary_consistent: isVocabularyConsistent,
  is_naming_convention_consistent: isNamingConventionConsistent,
  is_greppable: isGreppable,
  is_comment_business_context,
  is_comment_narration,
  is_comment_patching_readability,
  will_comment_drift,
  is_cognitively_complex: isCognitivelyComplex,
});
