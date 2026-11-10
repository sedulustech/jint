/**
 * SEO rules: how a page presents itself in a list of search results. A page's title and its
 * description are what a searcher sees, so these rules judge what a count cannot: whether the copy
 * says anything. Lengths, uniqueness and heading levels are a test's job and are not here. Open
 * Graph is a different domain (the card a shared link shows); these rules are about search.
 *
 * Each rule reads one built HTML page whole: the head and the body carry the title, the description
 * and the headings, so nothing is extracted from it. A high reading is bad.
 */

import type { NoulRuleSchema, RuleSchema } from "@jint/contract";

/**
 * Measured on the 25 built pages of this site's docs, labeled by hand: the pages with a clear title
 * read 0.00 to 0.05 (install, local, the CLI and config references, the use cases), the bare ones
 * 0.84 to 1.00 (targets, captures, grammars, directives, calibration, stale comments). Two planted
 * controls, a real page with its title tag cut to one word, read 0.89 and 0.88 against 0.00 for the
 * originals. Between the two sit titles that are arguable (0.16 to 0.73). The rule flags 9 of the
 * 25. One site and one page layout: not proven elsewhere.
 */
export const has_title_without_context: NoulRuleSchema = {
  name: "has_title_without_context",
  instructions:
    "A title has context when a searcher who sees only the page's title tag in a list of search results can tell what the page is about and what to expect from it. Does this page's title tag lack context: it is a bare label or fragment that tells a searcher nothing about the subject or what the page does?",
  criteria: {
    true: "The title tag is a bare label: a noun, a verb with no object, or an adjective alone, naming an area or a feature, with no object the verb acts on and no question. The site's name beside a bare label does not give it context, and neither does the rest of the page.",
    false:
      "The title tag is an action on a named object, a question, or a phrase that names its subject in words a searcher outside the product would use: it says what the page is about or what the reader can do.",
  },
  target: "files",
  include: ["**/*.html"],
  handle: {
    warn: {
      greater_than: 0.5,
      message: "Rewrite the title to name the subject or what the reader can do.",
    },
  },
};

/** Every rule of this domain, in run order. */
export const rules: readonly RuleSchema[] = [has_title_without_context];
