/**
 * Concept rules for the writing-rules skill: one rule per thing the skill has to say, so an edit
 * that drops one is a finding. A rule reads the skill whole and asks whether its body leaves the
 * concept out, so a high reading is bad. The skill is the unit, not each concept's sentence: a
 * concept stays when any sentence of the body says it, in any wording.
 *
 * Measured on the skill itself: all 21 rules read 0.00 on it. Each rule was also run on a copy of
 * the skill with that concept's text deleted: all 21 read 0.55 or higher, 13 of them 0.86 or
 * higher. The lowest is lacks_defect_as_true, 0.55, because the naming bullet still says a defect
 * is the true side. A concept whose sentence is stated twice reads lower when only one is deleted.
 * Added after, each 0.00 on the skill and measured on a copy without its text:
 * lacks_scoping_strategy 0.91, lacks_goal_decomposition 0.85, lacks_captures_skill_pointer 0.84
 * (both mentions deleted); lacks_jint_file_convention 0.97 with its paragraph deleted;
 * lacks_should_prefix_convention 0.93 with the should_ bullet deleted. One skill, one writer.
 */

import type { RuleSchema } from "jint:sdk";

/** One concept: what the skill says, and what a sentence that says it looks like. */
interface Concept {
  name: string;
  /** What the skill tells the reader, as the object of "the skill says that". */
  says: string;
  /** A sentence of the body that says it, as the object of "a sentence of the body". */
  cue: string;
  /** What the reader does about a finding. */
  message: string;
}

const CONCEPTS: readonly Concept[] = [
  {
    name: "lacks_docs_pointer",
    says: "`jint docs` lists the reference pages",
    cue: "says `jint docs` is the command that lists the reference pages",
    message: "Say that `jint docs` lists the reference pages.",
  },
  {
    name: "lacks_goal_decomposition",
    says: "a request for a rule often names a goal with several dimensions, so the reader asks the goal first and writes one rule per dimension",
    cue: "says that a goal is rarely one property, to ask what the user is trying to achieve, to list its dimensions and to write one rule for each",
    message: "Say that a goal holds several dimensions and each becomes its own rule.",
  },
  {
    name: "lacks_one_property_per_rule",
    says: "a rule asks one yes/no question about one property, and two properties are two rules",
    cue: "says that two properties belong in two rules, because one answer cannot say which failed",
    message: "Say that a rule asks one question about one property.",
  },
  {
    name: "lacks_defined_measured_word",
    says: "the instruction defines the word it measures instead of relying on it",
    cue: "says to define the measured word (informative, complete, consistent) inside the instruction",
    message: "Say to define the measured word inside the instruction.",
  },
  {
    name: "lacks_no_element_kind",
    says: "the instruction does not state the element kind, because the compiler prepends it",
    cue: "says not to state the element kind in the instructions",
    message: "Say not to state the element kind in the instructions.",
  },
  {
    name: "lacks_true_side_name",
    says: "a rule is named for its true side: has_ for a defect and is_ for a good property",
    cue: "says to name the rule for its true side, with has_ for a defect and is_ for a good property",
    message: "Say to name the rule for its true side.",
  },
  {
    name: "lacks_unit_text_only",
    says: "the model sees only the unit's own text",
    cue: "says the model sees only the unit's own text, so a claim about code elsewhere cannot be judged",
    message: "Say that the model sees only the unit's own text.",
  },
  {
    name: "lacks_capture_command",
    says: "`jint capture` lists the elements a rule judges at no cost",
    cue: "says to run `jint capture` to list the elements a rule judges",
    message: "Say to run `jint capture` before running the rule.",
  },
  {
    name: "lacks_captures_skill_pointer",
    says: "a construct that is not an element needs a new capture, and the writing-captures skill says how to add one",
    cue: "says that a construct no element covers needs a capture, and points to the writing-captures skill for adding it",
    message: "Say that a missing element needs a capture and point to the writing-captures skill.",
  },
  {
    name: "lacks_jint_file_convention",
    says: "a rule that no other project would want lives next to what it measures, in a <subject>.jint.ts file that exports its rules and sets its own include",
    cue: "says that a rule only this project wants goes in a <subject>.jint.ts file next to what it measures, scoped by its own include, and that a domain takes it only once other projects and languages show the same gap",
    message:
      "Say that a project-specific rule lives in a <subject>.jint.ts file next to its subject.",
  },
  {
    name: "lacks_should_prefix_convention",
    says: "has_, lacks_, is_ and will_ name properties, should_ names a placement verdict only, and a name never carries the fix",
    cue: "says that has_, lacks_, is_ and will_ name a property, that should_ is for a rule whose property is where the unit belongs, and that the fix goes in the handle's message and not in the name",
    message:
      "Say that should_ is only for placement verdicts and that the fix goes in the message, not the name.",
  },
  {
    name: "lacks_defect_as_true",
    says: "the defect is the true side of the criteria, with its concrete forms listed",
    cue: "says to put the defect, not the good state, on the true side, because the model leans yes",
    message: "Say to make the defect the true side and list its forms.",
  },
  {
    name: "lacks_exhaustive_criteria",
    says: "true and false each name an exact observable condition and together cover every case",
    cue: "says the true side and the false side each name an exact observable condition and are exhaustive",
    message: "Say that both criteria sides name an observable condition and are exhaustive.",
  },
  {
    name: "lacks_meaning_not_structure",
    says: "a rule asks about meaning, and counts, heading levels and formats belong in a test",
    cue: "says to ask about meaning, not structure, and to leave counts, levels and formats to a test",
    message: "Say to ask about meaning and leave structure to a test.",
  },
  {
    name: "lacks_other_kinds",
    says: "a score rule fits a graded property and a choice rule fits named options",
    cue: "says a score rule uses an ordered legend of levels, or a choice rule uses named options keyed by label",
    message: "Say when to use a score rule and a choice rule.",
  },
  {
    name: "lacks_probability_meaning",
    says: "a reading is the model's probability that the answer is true, that it carries meaning, and that 0.5 is undecided",
    cue: "says a noul reading is a probability that carries meaning: near 1 a strong lean to yes, near 0 a strong lean to no, and 0.5 undecided",
    message: "Say what a reading means and that 0.5 is undecided.",
  },
  {
    name: "lacks_threshold_floor",
    says: "a noul threshold is never set below 0.5",
    cue: "says never to set a noul threshold below 0.5",
    message: "Say never to set a noul threshold below 0.5.",
  },
  {
    name: "lacks_fixer_message",
    says: "each tier gets one imperative, singular fixer message",
    cue: "says to write one imperative, singular fixer message per tier",
    message: "Say to write one imperative fixer message per tier.",
  },
  {
    name: "lacks_threshold_gap",
    says: "thresholds go inside the gap between the healthy minimum and the defective maximum, and a rule whose readings overlap does not ship",
    cue: "says to set thresholds inside the gap between healthy and defective readings and not to ship a rule when they overlap",
    message: "Say to set thresholds inside the gap and not to ship an overlap.",
  },
  {
    name: "lacks_real_code_calibration",
    says: "calibration uses real code, a fixture written for the rule proves nothing, and a control is a real unit with one mechanical edit",
    cue: "says to calibrate on real code, not on a fixture written for the rule, and says a control is a real unit with one mechanical edit",
    message: "Say to calibrate on real code with controls.",
  },
  {
    name: "lacks_scoping_strategy",
    says: "scoping is running a rule on the narrowest slice of real code that answers the question and widening only once the slice answers it, one dimension at a time",
    cue: "says to scope first: start with one rule, a few units and one package, narrow by rule, input and include, and widen in steps, reading the fire rate and top readings by hand at each step",
    message:
      "Say that scoping means starting narrow and widening in steps, reading the readings at each step.",
  },
  {
    name: "lacks_show_readings",
    says: "the reader starts `jint ui serve` before running and gives the user the run's address",
    cue: "says to start `jint ui serve` before running and to give the user the address",
    message: "Say to start `jint ui serve` and share the address.",
  },
  {
    name: "lacks_domain_placement",
    says: "rules live in domains, one package each, imported as jint:rules/<domain>, and a subdomain never rewords its parent's question",
    cue: "says where a rule goes: a domain package imported as jint:rules/<domain>, with subdomains that never reword the parent's question",
    message: "Say where a rule goes and that a subdomain never rewords its parent.",
  },
  {
    name: "lacks_no_edit_to_pass",
    says: "a rule is never edited to make a finding pass",
    cue: "says never to edit a rule to make a finding pass",
    message: "Say never to edit a rule to make a finding pass.",
  },
  {
    name: "lacks_labeled_defective_example",
    says: "a rule is never shipped without a labeled defective example",
    cue: "says never to ship a rule with no labeled defective example",
    message: "Say never to ship a rule with no labeled defective example.",
  },
  {
    name: "lacks_feedback_issue",
    says: "a wrong, unclear or missing step is reported as an issue at sedulustech/jint",
    cue: "says to open an issue at sedulustech/jint when a step is wrong, unclear or missing",
    message: "Say to open an issue at sedulustech/jint.",
  },
];

const ruleFor = (concept: Concept): RuleSchema => ({
  name: concept.name,
  target: "files",
  include: ["skills/writing-rules/SKILL.md"],
  instructions: `Does this skill fail to say that ${concept.says}? The skill says it when a sentence of its body says it in any wording. Judge only the body under the title; the front matter is not judged.`,
  criteria: {
    true: `No sentence of the body ${concept.cue}, or the body says the opposite.`,
    false: `A sentence of the body ${concept.cue}, in any wording.`,
  },
  handle: {
    warn: { greater_than: 0.5 },
    error: { greater_than: 0.75, message: concept.message },
  },
});

/** One rule per concept the writing-rules skill states, in the order the skill states them. */
export const rules: readonly RuleSchema[] = CONCEPTS.map(ruleFor);
