/**
 * Required-claim rules for the writing-rules skill and the docs page of the same name: one rule per
 * claim they have to make, so an edit that drops one from either is a finding. A rule reads a
 * document whole and asks whether its body leaves the claim out, so a high value is bad. The
 * document is the unit, not each claim's sentence: a claim stays when any sentence of the body
 * makes it, in any wording.
 *
 * Measured on both documents: all 26 rules read 0.01 or lower. Each rule is a single wording over
 * both files, so a claim dropped from one document reads like a claim dropped from the other.
 * Measured on the docs page with the claim's text deleted: lacks_threshold_floor and
 * lacks_feedback_issue 1.00, lacks_no_edit_to_pass 0.95, lacks_scoping_strategy 0.88. Four of the
 * 26 were measured that way; the other 22 were not.
 */

import type { RuleSchema } from "jint:sdk";

/** One claim the documents must make, and what a sentence that makes it looks like. */
interface RequiredClaim {
  name: string;
  /** Completes "the document says that ...". */
  claim: string;
  /** Completes "a sentence of the body ...". */
  claimSentence: string;
  message: string;
  /** Only the skill states it: a procedure the guide leaves out. */
  skillOnly?: true;
}

const REQUIRED_CLAIMS: readonly RequiredClaim[] = [
  {
    name: "lacks_docs_pointer",
    claim: "`jint docs` lists the reference pages",
    claimSentence: "says `jint docs` is the command that lists the reference pages",
    message: "Say that `jint docs` lists the reference pages.",
    skillOnly: true,
  },
  {
    name: "lacks_goal_decomposition",
    claim:
      "a request for a rule often names a goal with several dimensions, so the reader asks the goal first and writes one rule per dimension",
    claimSentence:
      "says that a goal is rarely one property, to ask what the user is trying to achieve, to list its dimensions and to write one rule for each",
    message: "Say that a goal holds several dimensions and each becomes its own rule.",
  },
  {
    name: "lacks_one_property_per_rule",
    claim: "a rule asks one yes/no question about one property, and two properties are two rules",
    claimSentence:
      "says that two properties belong in two rules, because one answer cannot say which failed",
    message: "Say that a rule asks one question about one property.",
  },
  {
    name: "lacks_defined_measured_word",
    claim: "the instruction defines the word it measures instead of relying on it",
    claimSentence:
      "says to define the measured word (informative, complete, consistent) inside the instruction",
    message: "Say to define the measured word inside the instruction.",
  },
  {
    name: "lacks_no_kind_sentence",
    claim: "the engine adds no sentence naming the element kind to the question",
    claimSentence:
      "says the engine adds no sentence naming the element kind, so the question is the instructions and criteria as written",
    message: "Say that the engine adds no sentence naming the element kind.",
    skillOnly: true,
  },
  {
    name: "lacks_true_side_name",
    claim: "a rule is named for its true side: has_ for a defect and is_ for a good property",
    claimSentence:
      "says to name the rule for its true side, with has_ for a defect and is_ for a good property",
    message: "Say to name the rule for its true side.",
    skillOnly: true,
  },
  {
    name: "lacks_capture_command",
    claim: "`jint capture` lists the elements a rule judges at no cost",
    claimSentence: "says to run `jint capture` to list the elements a rule judges",
    message: "Say to run `jint capture` before running the rule.",
    skillOnly: true,
  },
  {
    name: "lacks_captures_skill_pointer",
    claim:
      "a construct that is not an element needs a new capture, and the writing-captures skill says how to add one",
    claimSentence:
      "says that a construct no element covers needs a capture, and points to the writing-captures skill for adding it",
    message: "Say that a missing element needs a capture and point to the writing-captures skill.",
    skillOnly: true,
  },
  {
    name: "lacks_jint_file_convention",
    claim:
      "a rule that no other project would want lives next to what it measures, in a <subject>.jint.ts file that exports its rules and sets its own include",
    claimSentence:
      "says that a rule only this project wants goes in a <subject>.jint.ts file next to what it measures, scoped by its own include, and that a domain takes it only once other projects and languages show the same gap",
    message:
      "Say that a project-specific rule lives in a <subject>.jint.ts file next to its subject.",
    skillOnly: true,
  },
  {
    name: "lacks_should_prefix_convention",
    claim:
      "has_, lacks_, is_ and will_ name properties, should_ names a placement verdict only, and a name never carries the fix",
    claimSentence:
      "says that has_, lacks_, is_ and will_ name a property, that should_ is for a rule whose property is where the unit belongs, and that the fix goes in the handle's message and not in the name",
    message:
      "Say that should_ is only for placement verdicts and that the fix goes in the message, not the name.",
    skillOnly: true,
  },
  {
    name: "lacks_defect_as_true",
    claim: "the defect is the true side of the criteria, with its concrete forms listed",
    claimSentence:
      "says to put the defect, not the good state, on the true side, because the model leans yes",
    message: "Say to make the defect the true side and list its forms.",
    skillOnly: true,
  },
  {
    name: "lacks_exhaustive_criteria",
    claim: "true and false each name an exact observable condition and together cover every case",
    claimSentence:
      "says the true side and the false side each name an exact observable condition and are exhaustive",
    message: "Say that both criteria sides name an observable condition and are exhaustive.",
    skillOnly: true,
  },
  {
    name: "lacks_statement_criteria",
    claim: "the true and false criteria are statements that decide the answer, never questions",
    claimSentence:
      "says the true side and the false side are written as statements that decide yes or no, never as a question",
    message: "Say that criteria are statements, never questions.",
    skillOnly: true,
  },
  {
    name: "lacks_meaning_not_structure",
    claim: "a rule asks about meaning, and counts, heading levels and formats belong in a test",
    claimSentence:
      "says to ask about meaning, not structure, and to leave counts, levels and formats to a test",
    message: "Say to ask about meaning and leave structure to a test.",
    skillOnly: true,
  },
  {
    name: "lacks_other_kinds",
    claim: "a score rule fits a graded property and a choice rule fits named options",
    claimSentence:
      "says a score rule uses an ordered legend of levels, or a choice rule uses named options keyed by label",
    message: "Say when to use a score rule and a choice rule.",
    skillOnly: true,
  },
  {
    name: "lacks_probability_meaning",
    claim:
      "a value is the model's probability that the answer is true, that it carries meaning, and that 0.5 is undecided",
    claimSentence:
      "says a noul value is a probability that carries meaning: near 1 a strong lean to yes, near 0 a strong lean to no, and 0.5 undecided",
    message: "Say what a value means and that 0.5 is undecided.",
  },
  {
    name: "lacks_threshold_floor",
    claim: "a noul threshold is never set below 0.5",
    claimSentence: "says never to set a noul threshold below 0.5",
    message: "Say never to set a noul threshold below 0.5.",
  },
  {
    name: "lacks_fixer_message",
    claim: "each tier gets one imperative, singular fixer message",
    claimSentence: "says to write one imperative, singular fixer message per tier",
    message: "Say to write one imperative fixer message per tier.",
  },
  {
    name: "lacks_threshold_gap",
    claim:
      "thresholds go inside the gap between the healthy minimum and the defective maximum, and a rule whose values overlap does not ship",
    claimSentence:
      "says to set thresholds inside the gap between healthy and defective values and not to ship a rule when they overlap",
    message: "Say to set thresholds inside the gap and not to ship an overlap.",
    skillOnly: true,
  },
  {
    name: "lacks_real_code_calibration",
    claim:
      "calibration uses real code, a fixture written for the rule proves nothing, and a control is a real unit with one mechanical edit",
    claimSentence:
      "says to calibrate on real code, not on a fixture written for the rule, and says a control is a real unit with one mechanical edit",
    message: "Say to calibrate on real code with controls.",
    skillOnly: true,
  },
  {
    name: "lacks_scoping_strategy",
    claim:
      "scoping is running a rule on the narrowest slice of real code that answers the question and widening only once the slice answers it, one dimension at a time",
    claimSentence:
      "says to scope first: start with one rule, a few units and one package, narrow by rule, input and include, and widen in steps, reading the fire rate and top values by hand at each step",
    message:
      "Say that scoping means starting narrow and widening in steps, reading the values at each step.",
    skillOnly: true,
  },
  {
    name: "lacks_show_readings",
    claim: "the reader starts `jint ui serve` before running and gives the user the run's address",
    claimSentence: "says to start `jint ui serve` before running and to give the user the address",
    message: "Say to start `jint ui serve` and share the address.",
    skillOnly: true,
  },
  {
    name: "lacks_domain_placement",
    claim:
      "rules live in domains, one package each, imported as jint:rules/<domain>, and a subdomain never rewords its parent's question",
    claimSentence:
      "says where a rule goes: a domain package imported as jint:rules/<domain>, with subdomains that never reword the parent's question",
    message: "Say where a rule goes and that a subdomain never rewords its parent.",
    skillOnly: true,
  },
  {
    name: "lacks_no_edit_to_pass",
    claim: "a rule is never edited to make a finding pass",
    claimSentence: "says never to edit a rule to make a finding pass",
    message: "Say never to edit a rule to make a finding pass.",
    skillOnly: true,
  },
  {
    name: "lacks_labeled_defective_example",
    claim: "a rule is never shipped without a labeled defective example",
    claimSentence: "says never to ship a rule with no labeled defective example",
    message: "Say never to ship a rule with no labeled defective example.",
    skillOnly: true,
  },
  {
    name: "lacks_feedback_issue",
    claim: "a wrong, unclear or missing step is reported as an issue at sedulustech/jint",
    claimSentence:
      "says to open an issue at sedulustech/jint when a step is wrong, unclear or missing",
    message: "Say to open an issue at sedulustech/jint.",
    skillOnly: true,
  },
];

const buildRequiredClaimRule = (required: RequiredClaim): RuleSchema => ({
  name: required.name,
  target: "files",
  include: required.skillOnly
    ? ["skills/writing-rules/SKILL.md"]
    : ["skills/writing-rules/SKILL.md", "docs/guides/writing-rules.md"],
  instructions: `Does this document fail to say that ${required.claim}? The document says it when a sentence of its body says it in any wording. Judge only the body under the title; the front matter is not judged.`,
  criteria: {
    true: `No sentence of the body ${required.claimSentence}, or the body says the opposite.`,
    false: `A sentence of the body ${required.claimSentence}, in any wording.`,
  },
  handle: {
    warn: { greater_than: 0.5 },
    error: { greater_than: 0.75, message: required.message },
  },
});

/** One rule per claim the writing-rules skill makes, in the order the skill makes them. */
export const rules: readonly RuleSchema[] = REQUIRED_CLAIMS.map(buildRequiredClaimRule);
