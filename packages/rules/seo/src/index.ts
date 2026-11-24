/**
 * SEO rules: how a page presents itself in a list of search results. A rule here names the parts of
 * the state it reads and leaves the state to the config: each project captures its pages its own
 * way. A high reading is bad.
 */

import type { NoulRuleSchema, RuleSchema } from "@jint/contract";

/**
 * The state holds two parts. `metaTitle` is the title a search result shows for the page, with the
 * site's name. `pageContent` is the page's main text, without its front matter, navigation or
 * footer. The criteria follow https://developers.google.com/search/docs/appearance/title-link.
 *
 * Measured on 20 labeled titles of this site's docs, each with its page: the 8 real titles read
 * 0.00 to 0.08, the same 8 cut to one word 0.30 to 0.94, and 4 real pages under another page's
 * title 0.71 to 1.00. The warn threshold misses 4 of the 8 cut titles. One site, markdown pages
 * only: not proven elsewhere.
 */
export const is_meta_title_vague: Omit<NoulRuleSchema, "target"> = {
  name: "is_meta_title_vague",
  instructions:
    "metaTitle is the title a search result shows for the page in pageContent; the part after the last separator is the site's name. Does metaTitle fail to describe pageContent?",
  criteria: {
    true: 'metaTitle is vague or inaccurate. Vague: a label such as "Home", "Profile" or "Overview" that would fit many pages and does not say which subject or task of pageContent this page covers. Inaccurate: it names a subject that is not the main subject of pageContent.',
    false:
      "metaTitle is descriptive, concise and accurate. It names the main subject of pageContent, or the task a reader completes with it, in specific words, so a searcher can tell this page from the site's other pages. A short title is fine when its words are specific.",
  },
  handle: {
    warn: { greater_than: 0.5 },
    error: {
      greater_than: 0.7,
      message: "Rewrite the title to name the page's main subject, or the task a reader completes.",
    },
  },
};

/** Rules of this domain that run as they are. */
export const rules: readonly RuleSchema[] = [];

/** Rules of this domain that a config completes with a target and a state. */
export const incompleteRules: readonly Omit<NoulRuleSchema, "target">[] = [is_meta_title_vague];
