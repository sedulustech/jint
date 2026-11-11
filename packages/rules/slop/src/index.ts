/**
 * Slop rules: the stock moves of machine-written prose. Each rule asks whether a text leans on one
 * template that language models produce far more often than people do: their favourite words, the
 * "it's not X, it's Y" frame, a maxim to close, a triad for rhythm, a trailing evaluative clause,
 * hype in place of detail, a stance nobody could dispute.
 *
 * A reading says the text has the template, not who wrote it. People write this way too, and
 * non-native and formal writers are flagged more often than others, so these rules suit a style
 * check on your own writing and a signal to weigh, never a verdict on an author. A high reading is
 * bad. Which files they read is set where the rules are used, not here.
 *
 * Sources for each template are named on its rule. Measured on the 25 pages of this repo's docs
 * (one site, one author, English) with three planted controls, a real page plus one sentence that
 * holds the template: a maxim closer read 1.00 against 0.00 for its original, stock vocabulary 1.00
 * against 0.00, a corrective frame 0.98 against 0.17. The other four rules have no control yet. On
 * the unedited pages the rules read 0.00 to 0.12, except two: the corrective frame reads 0.36 to
 * 0.72 on four pages (lines like "recalibrate the rule, not act on the code", arguably plain
 * corrections) and the trailing participle 0.59 on one (a true hit). Warn (0.5) fires only on those
 * two pages; error (0.8) fires on none. Other writers and languages are unmeasured: calibrate
 * before gating.
 */

import type { NoulRuleSchema, RuleSchema } from "@jint/contract";

/** What each rule reads: the prose, never the markup around it. */
const PROSE =
  "Judge only the running prose of the text. Front matter, code blocks, tables and link lists are context and are never judged.";

const handle = (message: string) => ({
  warn: { greater_than: 0.5, message },
  error: { greater_than: 0.8, message },
});

/**
 * Sources: https://www.science.org/doi/10.1126/sciadv.adt3813 (excess vocabulary in 15M abstracts),
 * https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing,
 * https://graphite.io/research/ai-tells. Strong in corpus studies, weak for one word in a short
 * text.
 */
export const has_ai_vocabulary: NoulRuleSchema = {
  name: "has_ai_vocabulary",
  instructions: `Does the text lean on words that language models overuse, used in their stock figurative sense? ${PROSE}`,
  criteria: {
    true: "The text uses two or more words or phrases from the overused set in their stock sense, or one of them carries the whole sentence: delve, tapestry, testament, pivotal, crucial, underscore(s), showcasing, highlighting, fostering, landscape, realm, intricate, interplay, vibrant, seamless, robust, leverage, elevate, unlock, streamline, game-changer, navigate (figurative), resonate(s), multifaceted, dependable, meaningful, deliberate, profound, quietly, at its core, the real unlock, moves the needle.",
    false:
      "The text contains none of these words, or only one used literally or as ordinary domain jargon (a 'robust' estimator, a 'landscape' photo, 'leverage' in finance), or quotes them in order to mock AI writing. Plain everyday vocabulary, slang and technical terms are this side.",
  },
  target: "files",
  handle: handle("Replace the stock word with the plain one, or say what you mean."),
};

/**
 * Sources: https://graphite.io/research/ai-tells ('not simply' 157x and 'is not just a _ it is'
 * 153x the human rate), https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing. A real
 * rebuttal is not the template, so the rule needs judgment.
 */
export const has_corrective_framing: NoulRuleSchema = {
  name: "has_corrective_framing",
  instructions: `Does the text define its point by contrast with a claim nobody made, in the 'it's not X, it's Y' family of templates? ${PROSE}`,
  criteria: {
    true: "The text contains a template that states what something is by denying something no one in the context asserted: 'it's not X, it's Y', 'X isn't Y — it's Z', 'not just X, but Y', 'not only X but also Y', 'less X, more Y', 'less like X and more like Y', 'Y rather than X' as a summary flourish, or 'no X, no Y, just Z'.",
    false:
      "The text has no such template, or the contrast answers a claim actually made earlier in the text (a real rebuttal: 'no, it's not a memory leak, it's the cache'), or the negation is a plain factual correction.",
  },
  target: "files",
  handle: handle("State what it is, without the claim nobody made."),
};

/**
 * Sources: https://graphite.io/research/ai-tells, https://arxiv.org/html/2501.15654. Folk to
 * moderate evidence.
 */
export const has_aphorism_closer: NoulRuleSchema = {
  name: "has_aphorism_closer",
  instructions: `Does the text end with a tidy maxim or summary line that restates its point as a general truth? ${PROSE}`,
  criteria: {
    true: "The last sentence is a quotable generalization or wrap-up that adds no new fact: 'Consistency wins.', 'That's the real moat.', 'Clarity beats clever every time.', 'The future belongs to those who X.', 'Exciting times ahead.', 'X builds Y; Z builds W.', 'Game on.', 'Onward.', or an equation-style line ('trust + speed = growth').",
    false:
      "The text ends on a concrete detail, a question, a link, an aside, a joke, or simply stops; or the text is a single sentence (a one-line joke, pun or claim): answer No whenever the text has only one sentence.",
  },
  target: "files",
  handle: handle("End on the last concrete detail; cut the maxim."),
};

/**
 * Sources: https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing,
 * https://graphite.io/research/ai-tells.
 */
export const has_inflated_significance: NoulRuleSchema = {
  name: "has_inflated_significance",
  instructions: `Does the text inflate the importance of an ordinary thing with stock significance claims or hype instead of saying what it is? ${PROSE}`,
  criteria: {
    true: "The text asserts broad importance or transformation without specifics: 'a testament to', 'a game changer', 'this changes everything', 'a huge step forward', 'redefining X', 'the future of X', 'X matters because', 'this is the frontier', 'a powerful reminder', stacked intensifiers ('absolutely', 'incredibly', 'truly') around a routine announcement.",
    false:
      "The text states what happened or what the author thinks in concrete terms, or its excitement is attached to a specific thing ('the cold start went from 4s to 300ms, wild'), or it is sarcasm or irony about hype.",
  },
  target: "files",
  handle: handle("Say what changed, with the number or the name."),
};

/**
 * Sources: https://www.pnas.org/doi/10.1073/pnas.2422455122 (present participial clauses at 5.3x
 * the human rate for GPT-4o), https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing. Strong
 * evidence; the rule asks the evaluative '-ing', not every '-ing'.
 */
export const has_participial_commentary: NoulRuleSchema = {
  name: "has_participial_commentary",
  instructions: `Does the text tack on '-ing' clauses that comment on the significance of what it just said? ${PROSE}`,
  criteria: {
    true: "A sentence ends with a present-participle clause that evaluates or interprets instead of reporting: ', highlighting the need for X', ', making it a must-read', ', showing how much X matters', ', ensuring Y', ', reflecting a broader shift'.",
    false:
      "The text has no such trailing evaluative participle clause; '-ing' words that are plain verbs or descriptions ('I'm shipping it today', 'running the tests now') are this side.",
  },
  target: "files",
  handle: handle("End the sentence at the fact; cut the clause that judges it."),
};

/**
 * Sources: https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing,
 * https://arxiv.org/html/2509.19163. Folk to moderate evidence.
 */
export const has_rule_of_three: NoulRuleSchema = {
  name: "has_rule_of_three",
  instructions: `Does the text pad its point with a triad of parallel adjectives, nouns or short phrases used as rhetorical rhythm? ${PROSE}`,
  criteria: {
    true: "The text contains a list of three (occasionally four) parallel items whose job is cadence rather than information: 'clear, concise, and actionable', 'faster, cheaper, better', 'authority, structure, and trust', 'Plan. Build. Ship.'",
    false:
      "The text has no such triad, or the listed items are concrete and each carries distinct information (three named tools, three steps of a real procedure, three numbers).",
  },
  target: "files",
  handle: handle("Keep the items that say something; drop the ones that fill the beat."),
};

/**
 * Sources: https://dejan.ai/blog/comment-bots/, https://graphite.io/research/ai-tells. Moderate
 * evidence.
 */
export const has_safe_consensus_stance: NoulRuleSchema = {
  name: "has_safe_consensus_stance",
  instructions: `Does the text avoid taking any position, settling into agreeable both-sides consensus or vague hedging? ${PROSE}`,
  criteria: {
    true: "The text expresses only uncontroversial, universally agreeable sentiment or both-sides balance ('there's room for both', 'it depends on the use case', 'balance is key', 'time will tell', 'excited to see where this goes', 'curious to see how this plays out') and commits to no claim that someone could disagree with.",
    false:
      "The text takes a position someone could dispute, disagrees, makes a prediction, complains, admits uncertainty about something specific, or asks a real question; or it is a plain factual statement or a joke.",
  },
  target: "files",
  handle: handle("Take a position, or cut the line."),
};

/** Every rule of this domain, in run order. */
export const rules: readonly RuleSchema[] = [
  has_ai_vocabulary,
  has_corrective_framing,
  has_aphorism_closer,
  has_inflated_significance,
  has_participial_commentary,
  has_rule_of_three,
  has_safe_consensus_stance,
];
