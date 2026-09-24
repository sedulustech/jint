/**
 * The eight default rules, each shipping a visible, overridable handle; one rule measures one
 * attribute. The comment family replaced the retired excessive_comments, whose attributes moved in
 * opposite directions and averaged the aggregate signal into noise.
 *
 * Rule names follow TypeSafe's proposition convention (is_/will_ prefix): each rule compiles to
 * exactly one noul question, so its name reads as the yes/no claim the question asks.
 *
 * Each rule ships its rule as criteria — the explicit 1-rule and 0-rule that compile straight into
 * the noul question's criteria (criteria-as-rule). Editing either side is a re-calibration event,
 * since thresholds are anchored to readings taken under the rule text.
 *
 * Handle policy: a healthy run never errors; warns are legitimate nudges. High=good rules error
 * below the healthy floor, high=bad rules above the healthy ceiling, anchored on the self-lint
 * corpus with the sibling-repo calibration fixtures as the external check. Current thresholds and
 * healthy ranges are documented in the README, next to the override examples.
 */

import type { Rule } from "../types.ts";

export const isNamePurposeful: Rule = {
  name: "is_name_purposeful",
  criteria: {
    true: "Every identifier's name in this code states what it does or holds: a reader can infer the thing's purpose from the name alone, without reading the surrounding code. Casing and convention style are not part of this judgment.",
    false:
      "At least one name reveals implementation instead of purpose (naming how it works, not what it is for), is a bare generic word that could label anything (data, handler, util, temp), or misleads by promising behavior or a kind the thing does not have.",
  },
  target: "definitions",
  handle: (value) => (value < 0.5 ? "error" : value < 0.6 ? "warn" : null),
};

export const isFunctionSrp: Rule = {
  name: "is_function_srp",
  criteria: {
    true: "The unit performs one cohesive responsibility: all its steps serve a single purpose its name and docblock state.",
    false:
      "There is more than one reason for the unit to change: it mixes business logic, data validation, and side effects.",
  },
  target: "functions",
  // provisional: high = SRP holds (high = good); anchored to the self-corpus after calibration
  handle: (value) => (value < 0.4 ? "error" : value < 0.55 ? "warn" : null),
};

export const isVocabularyConsistent: Rule = {
  name: "is_vocabulary_consistent",
  criteria: {
    true: "The new identifiers in this change keep one vocabulary with each other and with the names the change touches: the same concept always keeps the same word, and the same role keeps the same suffix or verb convention.",
    false:
      "Synonym drift is present: the same concept is referred to by two different words within the same change (user in one place, account for the same thing in another; cart versus basket), forcing a reader to learn two names for one idea. Different words for genuinely different concepts are not drift.",
  },
  target: "files",
  handle: (value) => (value < 0.6 ? "error" : value < 0.75 ? "warn" : null),
};

export const isNamingConventionConsistent: Rule = {
  name: "is_naming_convention_consistent",
  criteria: {
    true: "Identifiers of the same kind follow one casing convention - functions and variables in camelCase, types and classes in PascalCase, module-level constants in SCREAMING_SNAKE - or whichever single form the surrounding code has already established for that kind.",
    false:
      "Two different casing forms appear for the same kind within the change or module (getUserData beside fetch_user_data for two functions, OrderItem beside order_item for two types), forcing a reader to learn two shapes for one kind. Different kinds may use different conventions, and word choice or name quality are not casing failures.",
  },
  target: "definitions",
  // Error line sits in the self-corpus gap (0.56 -> 0.67) between the blatant
  // convention mixers and the consistent files; the clean corpus (mobius
  // 0.89-0.91) clears it by 0.24, and m1_bad_names (0.61) errors with it.
  handle: (value) => (value < 0.65 ? "error" : value < 0.85 ? "warn" : null),
};

export const isGreppable: Rule = {
  name: "is_greppable",
  criteria: {
    true: "The code identifiers here - functions, variables, types, constants, exported symbols - are greppable: written out in full at every occurrence, never split into fragments or dynamically constructed from pieces, never renamed at a boundary, and specific enough that a search hit is genuinely a reference to this thing.",
    false:
      "At least one identifier cannot be found by a single search: it is split into fragments or dynamically constructed from pieces, renamed at a boundary so the same concept needs two search strings, or is a bare word (data, handler, util) whose hits are mostly noise. CLI flag spellings, help text, and log messages are user-facing interface, not code identifiers, and are outside this rule.",
  },
  target: "files",
  handle: (value) => (value < 0.6 ? "error" : value < 0.75 ? "warn" : null),
};

export const is_comment_business_context: Rule = {
  name: "is_comment_business_context",
  criteria: {
    true: "The comments here carry business context a maintainer cannot recover from the code alone: why the code exists or why this approach was chosen - the requirement, constraint, or decision it serves, a pointer to where that decision lives (ticket, spec, incident, upstream contract), or a warning that the code must stay consistent with something outside itself.",
    false:
      "The comments only describe what the code does: docstrings restating a signature, prose narration of the statements, or style notes - nothing a maintainer could not recover from the code itself.",
  },
  target: "comments",
  // Null in v0, deliberately: high readings are a virtue and low readings are
  // not a defect (not all code needs recorded context), so no reading is
  // evidence of a problem - any threshold would flag healthy code. The
  // measurement still streams; enforce context requirements by overriding this
  // handle in config.
  handle: () => null,
};

export const is_comment_narration: Rule = {
  name: "is_comment_narration",
  criteria: {
    true: "At least one comment merely narrates the code: it restates what the code already says - translating statements into prose, echoing the identifier's own name, or annotating the obvious (an increment, an assignment, a return) - so removing it loses nothing a reader could not get from the code itself.",
    false:
      "Every comment here says something the code cannot: it states why the code exists, records a constraint, or flags a non-obvious trap.",
  },
  target: "comments",
  handle: (value) => (value > 0.45 ? "error" : value > 0.3 ? "warn" : null),
};

export const is_comment_patching_readability: Rule = {
  name: "is_comment_patching_readability",
  criteria: {
    true: "At least one comment exists to explain code that should read itself - patching dense expressions, tangled control flow, or misleading names with prose instead of the code being made readable. This is a code smell: the fix is rewriting the code, and the comment makes the confusion livable so the rewrite never happens.",
    false:
      "Every comment earns its place by carrying what code cannot: rationale, constraints, or external contracts. Comments that add what code cannot carry are not readability patches, even when the surrounding code is also hard to read.",
  },
  target: "comments",
  handle: (value) => (value > 0.55 ? "error" : value > 0.4 ? "warn" : null),
};

export const will_comment_drift: Rule = {
  name: "will_comment_drift",
  criteria: {
    true: "At least one comment pins specific artifacts by name - files, functions, parameters, constants, types, paths - such that renaming or removing that artifact silently invalidates the comment while the code keeps working. The claim is coupling between the comment's wording and identifiers, not comments already wrong today.",
    false:
      "No comment here is coupled to specific artifacts by name: every comment describes behavior, rationale, or constraints without pinning identifiers, so renaming or removing code can never silently invalidate it.",
  },
  target: "comments",
  // Anchored above the healthy distribution on purpose: comments that pin
  // artifact names are common in healthy code, so the bar sits at strong
  // assertions only.
  handle: (value) => (value > 0.7 ? "error" : value > 0.55 ? "warn" : null),
};

export const isCognitivelyComplex: Rule = {
  name: "is_cognitively_complex",
  criteria: {
    true: "The code carries accidental difficulty the author could remove without changing what it does: nesting so deep the reader must track a stack of conditions, several unrelated concerns mixed into one unit, state the reader must hold in mind across lines, or a non-linear order forcing jumps instead of top-to-bottom reading.",
    false:
      "The code's difficulty is inherent to the problem: every case genuinely exists, the data is what the domain forces, and the solution reads top to bottom. Complexity inherent to the problem - cases that genuinely exist, data the domain itself forces - is not this failure.",
  },
  target: "definitions",
  // Thresholds kept from the previous anchor: the scoped claim lowered the
  // healthy ceiling on both calibration corpora, widening the margin to the
  // bloat/obfuscate mutants, which land in the warn band.
  handle: (value) => (value > 0.6 ? "error" : value > 0.45 ? "warn" : null),
};

// provisional: first choice rule — scored rubric via the jev score primitive; thresholds
// unanchored until the self-lint corpus has score readings
export const isReadability: Rule = {
  name: "is_readability",
  kind: "choice",
  instructions:
    "How easy is `source` to read at the identifier/structure level? Do not score algorithmic hardness. Do not score comments here.",
  criteria: [
    "Names, structure, and types make the story obvious.",
    "Mostly clear; a few opaque names or a slightly awkward shape.",
    "Reader must reconstruct intent from implementation details.",
    "Dense, misleading names, or structure that fights the problem.",
  ],
  target: "definitions",
  handle: (value) => (value >= 3 ? "error" : value >= 2 ? "warn" : null),
};

/** All default rules by name — the `rules.defaults` record of the config surface. */
export const defaultRules: Record<string, Rule> = Object.freeze({
  is_name_purposeful: isNamePurposeful,
  is_vocabulary_consistent: isVocabularyConsistent,
  is_naming_convention_consistent: isNamingConventionConsistent,
  is_greppable: isGreppable,
  is_comment_business_context,
  is_comment_narration,
  is_comment_patching_readability,
  will_comment_drift,
  is_cognitively_complex: isCognitivelyComplex,
  is_function_srp: isFunctionSrp,
  is_readability: isReadability,
});
