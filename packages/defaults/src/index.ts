/**
 * The default rule set, DECLARATIVE: every entry here is the exact shape a jint.config.json rule
 * entry takes (name, kind, criteria, instructions, target, handle as data) - the single source of
 * truth the engine's compiled baseline (@jint/sdk rules/defaults.ts) compiles from, through the
 * same declarative-compile seam the JSON config tier uses. Calibration comments are the calibration
 * record: thresholds are anchored to readings taken under the rule text, so moving a threshold or
 * editing a criteria line is a recalibration event.
 */

import type { NoulHandlerData, RuleTarget, ScoreHandlerData } from "@jint/contract";

export type { RuleTarget };

/** A binary-claim rule: the {true, false} criteria compile straight into the noul question. */
export interface NoulRuleSchema {
  readonly name: string;
  readonly kind?: "noul";
  readonly instructions: string;
  readonly criteria: { readonly true: string; readonly false: string };
  readonly target: RuleTarget;
  readonly handle: NoulHandlerData;
  /** Per-rule scope (issue 008): glob lists over the walk's paths; unset = all in-scope paths. */
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

/** A graded rule: the ordered rubric is indexed by score 0..N; the handle is a score map. */
export interface ChoiceRuleSchema {
  readonly name: string;
  readonly kind: "choice";
  readonly instructions: string;
  readonly criteria: readonly string[];
  readonly target: RuleTarget;
  readonly handle: ScoreHandlerData;
  /** Per-rule scope (issue 008): glob lists over the walk's paths; unset = all in-scope paths. */
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

/** A declarative rule: exactly one of the two kinds. */
export type RuleSchema = NoulRuleSchema | ChoiceRuleSchema;

/**
 * HANDLERS ARE TYPED DATA: every default handle is a NoulHandler (each threshold names its own
 * direction and ceiling — see handle.ts) or, for choice rules, a ScoreHandler (one map level per
 * criterion), compiled to the internal function form at module init. Recalibration is now editing
 * numbers in one place — and paste-able into jint.config.json. The declarative config surface
 * requires a real handle; probing is measuring - read the --json measurements and discard findings
 * (the handle only decides when readings surface), never a null handle.
 */

export const isNamePurposeful: ChoiceRuleSchema = {
  name: "is_name_purposeful",
  kind: "choice",
  instructions:
    "Count this unit's identifiers whose names fail to state what the thing does or holds. A failing name names the implementation instead of the purpose, is a bare generic word that could label anything (data, handler, util, temp), or misleads by promising behavior or a kind the thing does not have. Casing and convention style are not part of this judgment.",
  criteria: [
    "No violations: every identifier's name states what it does or holds - a reader can infer each thing's purpose from the name alone, without reading the surrounding code.",
    "One violation: exactly one identifier's name hides its purpose - it names how the code works rather than what it is for, is a bare generic word, or misleads.",
    "Several violations: more than one identifier's name hides its purpose in any of these ways.",
  ],
  target: "definitions",
  // Score, not probability: the old noul form asked for P(no bad name) and hedged near 0.5 on
  // healthy code (walker dogfood, 2026-10-12: identical names scored 0.23-0.43 run to run),
  // while the criteria itself counts violations. Levels are bounded 0..2; the map makes one
  // bad name a warn and pervasive bad naming an error - a single offender no longer fails a
  // whole unit. Re-probe on a second language before v1.0.0 (issue 001's two-language bar).
  handle: { map: ["pass", "warn", "error"] },
};

export const isFunctionSrp: NoulRuleSchema = {
  name: "is_function_srp",
  instructions:
    "Does this unit serve a single cohesive responsibility, every step serving one stated purpose?",
  criteria: {
    true: "The unit performs one cohesive responsibility: all its steps serve a single purpose its name and docblock state.",
    false:
      "There is more than one reason for the unit to change: it mixes business logic, data validation, and side effects.",
  },
  target: "functions",
  // Defect pole "false" (a unit serving several purposes). Calibrated under the per-rule
  // question (issue 001): the whole-project healthy median is P(good) 0.54 (P(bad) 0.46) and
  // the low tail - dominated by test callbacks, issue 008 - starts near P(bad) 0.55, so
  // warn_at 0.55 keeps roughly the bottom 8% in warn; nothing anchors error_at 0.7 yet below
  // a clearly broken unit.
  handle: { warn: { less_than: 0.45 }, error: { less_than: 0.3 } },
};

/**
 * Promoted from the seam-purity probe (tmp/probes/seam-purity.config.json), where it was the
 * densest signal (13 findings on the vendor-adapter corpus); exercised on every self-lint run
 * since, and held up in use.
 */
export const willErrorLoseCause: NoulRuleSchema = {
  name: "will_error_lose_cause",
  instructions: "Does this function's error handling lose information about the original failure?",
  criteria: {
    true: "Error handling loses information: a caught error is swallowed, rethrown without its cause, or replaced by a message that drops the original failure detail.",
    false:
      "Error handling preserves information: causes are chained, messages include the original failure detail, and nothing is swallowed silently.",
  },
  target: "functions",
  handle: { warn: { greater_than: 0.4 }, error: { greater_than: 0.7 } },
};
export const isVocabularyConsistent: NoulRuleSchema = {
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

export const isNamingConventionConsistent: NoulRuleSchema = {
  name: "is_naming_convention_consistent",
  instructions: "Do identifiers of the same kind in this unit follow a single casing convention?",
  // (threshold note: re-anchored below for the per-rule question, issue 001)
  criteria: {
    true: "Identifiers of the same kind follow one casing convention - functions and variables in camelCase, types and classes in PascalCase, module-level constants in SCREAMING_SNAKE - or whichever single form the surrounding code has already established for that kind.",
    false:
      "Two different casing forms appear for the same kind within the change or module (getUserData beside fetch_user_data for two functions, OrderItem beside order_item for two types), forcing a reader to learn two shapes for one kind. Different kinds may use different conventions, and word choice or name quality are not casing failures.",
  },
  target: "definitions",
  // Defect pole "false" (casing conventions mixed). The self-corpus gap between the blatant
  // convention mixers and the consistent files (P(good) 0.56 -> 0.67, i.e. P(bad) 0.44 -> 0.33)
  // puts error_at 0.35 above the healthy p5 (P(bad) 0.28) and m1_bad_names (P(bad) 0.39)
  // errors with it; warn_at 0.25 keeps the clean corpus (P(bad) 0.09-0.11) clear.
  handle: { warn: { less_than: 0.75 }, error: { less_than: 0.65 } },
};

/**
 * Promoted from the filename-fit probe (tmp/filename-fit.config.json, issue 006) after a
 * two-language calibration: healthy max 0.33 (Go, cobra) / 0.36 (TS, jint src/) against defective
 * min 0.60 / 0.88 - thresholds sit mid-gap on both. Element rules cannot see the path, so this is
 * the only rule that can catch "json.ts whose body renders HTML reports".
 */
export const isFilenameFitting: NoulRuleSchema = {
  name: "is_filename_fitting",
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

export const isGreppable: NoulRuleSchema = {
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

export const is_comment_narration: NoulRuleSchema = {
  name: "is_comment_narration",
  instructions:
    "Does any comment in this unit merely restate what the code in this unit already says, so that removing it loses nothing a reader could not get from the code itself?",
  criteria: {
    true: "At least one comment merely narrates the code: it restates what the code already says - translating statements into prose, echoing the identifier's own name, or annotating the obvious (an increment, an assignment, a return) - so removing it loses nothing a reader could not get from the code itself.",
    false:
      "Every comment here says something the code cannot: it states why the code exists, records a constraint, or flags a non-obvious trap.",
  },
  target: "comments",
  handle: { warn: { greater_than: 0.3 }, error: { greater_than: 0.45 } },
};

export const is_comment_patching_readability: NoulRuleSchema = {
  name: "is_comment_patching_readability",
  instructions:
    "Does any comment here patch code that should read itself, instead of the code being made readable?",
  criteria: {
    true: "At least one comment exists to explain code that should read itself - patching dense expressions, tangled control flow, or misleading names with prose instead of the code being made readable. This is a code smell: the fix is rewriting the code, and the comment makes the confusion livable so the rewrite never happens.",
    false:
      "Every comment earns its place by carrying what code cannot: rationale, constraints, or external contracts. Comments that add what code cannot carry are not readability patches, even when the surrounding code is also hard to read.",
  },
  target: "comments",
  handle: { warn: { greater_than: 0.4 }, error: { greater_than: 0.55 } },
};

export const will_comment_drift: NoulRuleSchema = {
  name: "will_comment_drift",
  instructions:
    "Does any comment pin specific artifacts by name such that renaming or removing them silently invalidates the comment?",
  criteria: {
    true: "At least one comment pins specific artifacts by name - files, functions, parameters, constants, types, paths - such that renaming or removing that artifact silently invalidates the comment while the code keeps working. The claim is coupling between the comment's wording and identifiers, not comments already wrong today.",
    false:
      "No comment here is coupled to specific artifacts by name: every comment describes behavior, rationale, or constraints without pinning identifiers, so renaming or removing code can never silently invalidate it.",
  },
  target: "comments",
  // Anchored above the healthy distribution on purpose: comments that pin
  // artifact names are common in healthy code, so the bar sits at strong
  // assertions only.
  handle: { warn: { greater_than: 0.55 }, error: { greater_than: 0.7 } },
};

// provisional: first choice rule — scored rubric via the jev score primitive; unanchored until
// the self-lint corpus has score readings
export const isCognitivelyComplex: ChoiceRuleSchema = {
  name: "is_cognitively_complex",
  kind: "choice",
  instructions:
    "How much EFFORT does a reader need to follow this code's logic - effort caused by structure the author chose, not by the problem itself? Ignore length alone: a long linear unit with one job reads as easy. Ignore inherent complexity: cases the data or the domain genuinely force are not this failure. Judge how hard the code's own structure makes it to read top-to-bottom.",
  criteria: [
    "Easy: the logic reads top-to-bottom. A single pass suffices. Any difficulty present is inherent to the problem, not to the structure.",
    "Moderate: the reader must pause once or twice - hold a small amount of state across a few lines, or re-check an outer condition - but the structure is otherwise linear and the full flow is recoverable by re-reading one or two spots.",
    "Hard: following the code requires actively reconstructing its flow - a stack of nested conditions to track, several unrelated concerns fused into one unit, state held across many lines, or an order that forces jumps instead of top-to-bottom reading. The structural difficulty could be removed without changing what the code does.",
  ],
  target: "definitions",
  // Calibrated 2026-09-29 (two-language: app/src + cobra, healthy/defective fixtures):
  // scores are bounded 0..2; error at round>=2 (>=1.5) sits between cobra healthy-max 1.46
  // and defective stacked fixtures 1.95/1.97; warn at round>=1 (>=0.5) warns 5-13% of healthy.
  handle: { map: ["pass", "warn", "error"] },
};

/**
 * The default set assembled in baseline order from the rule consts above. Whole-baseline
 * consumption: `rules: defaultRules`; spread to compose (`...defaultRules, myRule`), never mutate.
 */
export const defaultRules: readonly RuleSchema[] = Object.freeze([
  isNamePurposeful,
  isVocabularyConsistent,
  isNamingConventionConsistent,
  isGreppable,
  isFilenameFitting,
  is_comment_narration,
  is_comment_patching_readability,
  will_comment_drift,
  willErrorLoseCause,
  isCognitivelyComplex,
  isFunctionSrp,
]);

// Snake-case aliases, one per rule - the pick-and-override consumption: a config takes the
// rules it wants and spreads overrides over them ({ ...is_greppable, include: ["src/**"] }).
// The alias name IS the rule name, so a config reads identically to the JSON tier's entries.
export const is_name_purposeful = isNamePurposeful;
export const is_vocabulary_consistent = isVocabularyConsistent;
export const is_naming_convention_consistent = isNamingConventionConsistent;
export const is_greppable = isGreppable;
export const is_filename_fitting = isFilenameFitting;
export const will_error_lose_cause = willErrorLoseCause;
export const is_cognitively_complex = isCognitivelyComplex;
export const is_function_srp = isFunctionSrp;
