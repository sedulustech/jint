/**
 * Description rules for the skills in skills/: one rule per way a skill's description fails the
 * documented best practices. A skill is found by its description, which is read before the skill
 * is, so the description has to say what the skill does, when to use it, in the third person and in
 * specific terms, and leave the procedure to the body. The countable limits (name format, length,
 * no XML tags) are a test in skills.test.ts, not a rule.
 *
 * Measured on the four real descriptions and on real descriptions with one planted defect each: the
 * real ones read 0.27 or lower on every rule except has_description_procedure, where two read 0.64
 * and 0.72 (a list of what the skill covers); the planted defects read 0.79 or higher, and 1.00 on
 * the procedure rule. Each rule has one error tier: the readings left no case for a warning.
 */

import type { RuleSchema } from "jint:sdk";

const SCOPE =
  "Judge only the description in the front matter. The name and the body are not judged.";

/** One dimension of a description, and the sentence of a defect that fails it. */
interface Dimension {
  name: string;
  asks: string;
  defect: string;
  sound: string;
  message: string;
  /** The reading above which the rule fires, inside the gap between the real and planted readings. */
  above: number;
}

const DIMENSIONS: readonly Dimension[] = [
  {
    name: "lacks_description_capability",
    asks: "Does the description fail to say what the skill does?",
    defect:
      "The description names no capability: it does not say what the skill produces or does, or names only a topic it relates to.",
    sound:
      "The description says what the skill does, in a verb phrase with an action and an object, such as writes and calibrates rules or extracts text from files.",
    message: "Say in the description what the skill does.",
    above: 0.75,
  },
  {
    name: "lacks_description_trigger",
    asks: "Does the description fail to say when to use the skill?",
    defect:
      "The description names no situation, request or context that should select the skill: no use-when sentence and no phrases a user would say. A list of what the skill covers or contains is not a trigger.",
    sound:
      "The description names the situations, requests or contexts in which the skill is used, such as a use-when sentence or a list of trigger phrases.",
    message: "Say in the description when to use the skill.",
    above: 0.75,
  },
  {
    name: "has_description_wrong_person",
    asks: "Is the description written in the first or second person?",
    defect:
      "The description speaks as the author or addresses the reader with a pronoun: I, my, we, you or your, as in I can help you write rules or You can use this to check code.",
    sound:
      "The description is in the third person or the imperative and uses none of those pronouns, as in Writes and calibrates rules. Use when the user asks for a rule.",
    message: "Rewrite the description in the third person, with no I, we or you.",
    above: 0.75,
  },
  {
    name: "has_description_vague_terms",
    asks: "Is the description too generic to select the skill, resting on vague words in place of specific terms?",
    defect:
      "The description relies on generic words such as helps with, works with, processes data, handles documents or does stuff, and names no specific object, file kind, command or phrase a user would say.",
    sound:
      "The description names specific things: the objects it acts on, the file kinds or commands involved, and the phrases that call for it.",
    message: "Name the specific objects, commands and phrases instead of generic words.",
    above: 0.75,
  },
  {
    name: "has_description_procedure",
    asks: "Does the description carry how the skill works, where it should say only what the skill is for and when to use it?",
    defect:
      "The description lists steps, commands with flags, thresholds, file paths or reasoning about how to do the work, which belong in the body of the skill.",
    sound:
      "The description holds only what the skill does and when to use it, with key terms, and leaves the procedure to the body.",
    message: "Move the procedure from the description into the body.",
    above: 0.85,
  },
];

const ruleFor = (dimension: Dimension): RuleSchema => ({
  name: dimension.name,
  target: "files",
  include: ["skills/*/SKILL.md"],
  instructions: `${dimension.asks} ${SCOPE}`,
  criteria: { true: dimension.defect, false: dimension.sound },
  handle: { error: { greater_than: dimension.above, message: dimension.message } },
});

export const rules: readonly RuleSchema[] = DIMENSIONS.map(ruleFor);
