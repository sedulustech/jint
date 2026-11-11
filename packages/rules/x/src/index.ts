/**
 * X rules: whether a post on X reads as machine-written, from what only a post has: the post it
 * answers, the account behind it and the account's earlier posts. A domain of its own because each
 * rule reads a document in one fixed shape (below) that a pipeline builds from the X API; the
 * text-only templates of machine prose are the slop domain.
 *
 * The document is Markdown, one file per post, with these sections in order: the post, the parent
 * post, account metadata, computed signals (counts and similarities a script measured), and the
 * author's other recent posts. `SECTIONS` and `SIGNALS` name them, so the file's writer and the
 * rules read the same words. A reading is about the post's template, not its author, and a short
 * reply carries little text to read: the rules that read context carry the most weight. A high
 * reading is bad. Thresholds are the ones the rules were first written with, not calibrated here.
 */

import type { NoulRuleSchema, RuleSchema } from "@jint/contract";

/** Markdown section headings in each post's file. */
export const SECTIONS = {
  POST: "## Post",
  PARENT: "## Parent post",
  META: "## Metadata",
  SIGNALS: "## Computed signals",
  HISTORY: "## Author's other recent posts",
} as const;

/** Field names written under SECTIONS.SIGNALS by the script that measures a post. */
export const SIGNALS = {
  POST_SENTENCES: "post_sentences",
  POST_WORDS: "post_words",
  MAX_HISTORY_SIMILARITY: "max_similarity_to_author_history",
  NEAR_DUP_PAIRS_IN_HISTORY: "near_duplicate_pairs_in_history",
  SHARED_OPENER_SHARE: "share_of_history_with_same_opener",
} as const;

const S = SECTIONS;

const SCOPE_VS_PARENT = `Judge the text under '${S.POST}' against the text under '${S.PARENT}'; '${S.META}', '${S.SIGNALS}' and '${S.HISTORY}' are not judged here.`;
const SCOPE_VS_HISTORY = `Judge the text under '${S.POST}' together with the list under '${S.HISTORY}' and the values under '${S.SIGNALS}'; '${S.PARENT}' and '${S.META}' are background only.`;
const SCOPE_POST = `Judge only the text under the '${S.POST}' heading. The other sections (front matter, '${S.PARENT}', '${S.META}', '${S.SIGNALS}', '${S.HISTORY}') are context for reading the post and are never themselves judged.`;
/** A missing parent answers No: missing context must lower recall, not precision. */
const NO_PARENT = `The '${S.PARENT}' section is missing, 'none' or 'unknown' (then answer No)`;

const handle = (message: string) => ({
  warn: { greater_than: 0.35, message },
  error: { greater_than: 0.6, message },
});

/**
 * Sources: https://botblind.app/how-to-tell-if-an-x-account-is-a-bot,
 * https://dejan.ai/blog/comment-bots/, https://arxiv.org/html/2509.19163.
 */
export const is_context_free_reply: NoulRuleSchema = {
  name: "is_context_free_reply",
  instructions: `Is this reply so generic that it would fit under many unrelated posts on the same broad topic? ${SCOPE_VS_PARENT}`,
  criteria: {
    true: `The '${S.PARENT}' section has text, the post is at least about 12 words of commentary, insight or advice, and it could be pasted under a different post on the same broad topic without anyone noticing: it names no specific detail, person, number, screenshot, claim or wording from the parent, and engages only with the topic in general ('AI is changing everything', 'consistency really matters').`,
    false: `${NO_PARENT}, or the post refers to something particular to the parent: a named detail, a quote, a number, a direct question about it, a disagreement with its specific claim, or an in-joke that only works there. Short reactions under about 12 words ('source?', 'lol', 'couldn't agree more', 'SO CUTE'), raw emotional reactions (all caps, '!!!', insults, fan gushing with typos) and jokes are this side even when generic.`,
  },
  target: "files",
  handle: handle("Refer to something in the post you answer."),
};

/**
 * Sources: https://dejan.ai/blog/comment-bots/, https://arxiv.org/html/2509.19163,
 * https://botblind.app/how-to-tell-if-an-x-account-is-a-bot.
 */
export const restates_parent_without_adding: NoulRuleSchema = {
  name: "restates_parent_without_adding",
  instructions: `Does the reply mostly paraphrase the parent post's own point back to it, adding no new fact, experience, question or objection? ${SCOPE_VS_PARENT}`,
  criteria: {
    true: `The '${S.PARENT}' section has text and the post's substance is a reworded summary of the parent's claim (often 'X really is Y' or 'the point about X is key'), with no new information, example, counterpoint, question or personal experience.`,
    false: `${NO_PARENT}, or the post adds something the parent did not say: a fact, an example, a number, a link, a question, a disagreement, a joke, or a first-hand experience.`,
  },
  target: "files",
  handle: handle("Add something the post you answer did not say."),
};

/**
 * Exact and near-exact copies are a script's job (string similarity); this rule judges the shared
 * template shape that similarity misses. Sources:
 * https://botblind.app/how-to-tell-if-an-x-account-is-a-bot, https://arxiv.org/abs/2303.03697,
 * https://dejan.ai/blog/comment-bots/.
 */
export const has_templated_author_history: NoulRuleSchema = {
  name: "has_templated_author_history",
  instructions: `Do the author's other recent posts share this post's template, so the post looks like one output of a reply machine? ${SCOPE_VS_HISTORY} '${SIGNALS.MAX_HISTORY_SIMILARITY}', '${SIGNALS.NEAR_DUP_PAIRS_IN_HISTORY}' and '${SIGNALS.SHARED_OPENER_SHARE}' are string-similarity measurements from code; judge the shape the texts share, which those numbers can miss.`,
  criteria: {
    true: `The '${S.HISTORY}' section lists at least three posts, and most of them share the post's shape (for example compliment + restatement + maxim, or the same opener, the same closing line, the same emoji trail, the same 'claim + two-option question' pattern) or near-duplicate wording, across unrelated large accounts and topics.`,
    false: `The '${S.HISTORY}' section is missing, 'unknown' or lists fewer than three posts (then answer No), or the author's posts vary in length, register, topic and shape the way a person's do: arguments, typos, jokes, personal updates, one-word replies.`,
  },
  target: "files",
  handle: handle("Vary the shape of the account's posts."),
};

/**
 * Sources: https://graphite.io/research/ai-tells, https://dejan.ai/blog/comment-bots/. First-person
 * cues are fakeable (https://www.pnas.org/doi/10.1073/pnas.2208839120), so a pass is weak
 * evidence.
 */
export const lacks_lived_specificity: NoulRuleSchema = {
  name: "lacks_lived_specificity",
  instructions: `Is a multi-sentence post entirely abstract, with no first-hand detail, concrete particular or personal stake? ${SCOPE_POST} '${SIGNALS.POST_SENTENCES}' under '${S.SIGNALS}' is the post's sentence count from code.`,
  criteria: {
    true: `'${SIGNALS.POST_SENTENCES}' is 2 or more, and no sentence of the post contains a concrete particular: no first-hand experience ('we tried', 'my build'), no number, name, date, product version, place, code, error message, link, or personal feeling tied to a specific event. Everything is general advice or abstraction.`,
    false: `The post contains at least one concrete particular or first-hand detail, or '${SIGNALS.POST_SENTENCES}' is 1 or less (short posts are not judged on this dimension).`,
  },
  target: "files",
  handle: handle("Name one thing you saw or did."),
};

/** Every rule of this domain, in run order. */
export const rules: readonly RuleSchema[] = [
  is_context_free_reply,
  restates_parent_without_adding,
  has_templated_author_history,
  lacks_lived_specificity,
];
