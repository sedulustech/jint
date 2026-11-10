/**
 * Open Graph rules: how a page presents itself where it is shared - the title, the description and
 * the social image. A domain of its own, not an official one: it was calibrated on this site alone
 * (Astro), so it stays with the site until it has met another page layout.
 *
 * The lengths a metadata checker counts (a title of 50-60 characters) are a plain script's job and
 * are not here. These rules judge what a count cannot: whether the copy says anything. Each rule
 * reads one file whole, so it applies to any file that sets a page's tags and reads true on a file
 * that sets none. A high reading is good. The files each rule reads are set where the rules are
 * used (jint.config.ts), not here.
 */

import type { RuleSchema } from "jint:sdk";

const NOT_APPLICABLE =
  "This file sets no page title, description or social image, so there is nothing to judge.";

export const has_call_to_action: RuleSchema = {
  name: "has_call_to_action",
  instructions:
    "Does the page's description or title tell the reader what to do or what they get next, beyond naming the product?",
  criteria: {
    true: `${NOT_APPLICABLE} Otherwise the description or title invites an action or names an outcome the reader can expect: install it, read the guide, try it, get something specific.`,
    false:
      "The description or title only names or characterizes the product (a tagline, a category label) and gives the reader no action to take and no outcome to expect.",
  },
  target: "files",
  handle: {
    warn: { less_than: 0.6, message: "Say what the reader can do or get in the description." },
  },
};

/**
 * Measured on this site's pages, with a planted control for each defect (one mechanical edit of a
 * real page): the three healthy readings are 0.56 (the download page), 0.66 and 0.76; the two
 * defective ones are 0.00 (a description cut to "Download jint.") and 0.11 (the home page's
 * one-line description). The threshold sits in that gap. Three pages of one layout: not proven
 * elsewhere.
 */
export const is_description_complete: RuleSchema = {
  name: "is_description_complete",
  instructions:
    "Complete means the description answers two questions: what the page is, and what the reader gets from it. Judge the description alone, not the title. Does the description answer both, in a sentence or two?",
  criteria: {
    true: `${NOT_APPLICABLE} Otherwise the description says what the page is and what the reader gets from it, in a full sentence.`,
    false:
      "The description leaves out what the page is or what the reader gets from it. A slogan, a bare name or a fragment of a sentence is not complete.",
  },
  target: "files",
  handle: {
    warn: {
      less_than: 0.3,
      message: "Write a description that says what the page is and what the reader gets.",
    },
  },
};

/**
 * Measured as is_description_complete is: the healthy readings are 0.99 and 1.00 (the download
 * page, with its own description and with a one-word one, so the title is judged alone); the
 * defective ones are 0.02 to 0.07 (the product name with a category) and 0.25 (the 404 page's "not
 * found").
 */
export const is_title_informative: RuleSchema = {
  name: "is_title_informative",
  instructions:
    "Informative means a reader who sees only the title, as a search result or a browser tab, can tell what the page is about. Judge the title alone, not the description. Does the page's title name the page's subject or what the reader gets, in words beyond the product name and a category?",
  criteria: {
    true: `${NOT_APPLICABLE} Otherwise the title names the page's subject or the reader's gain, so a reader tells this page from the product's others.`,
    false:
      "The title is the product name with a category or a generic word (a brand and a label), and says nothing about what this page offers.",
  },
  target: "files",
  handle: { warn: { less_than: 0.6, message: "Put what this page is about in the title." } },
};

export const has_image_alt_text: RuleSchema = {
  name: "has_image_alt_text",
  instructions:
    "Does the social image have alt text that says what the image shows, including any text printed on it?",
  criteria: {
    true: `This file sets no social image, or it sets one with alt text (og:image:alt or twitter:image:alt) that says what the image shows, and states any text printed on it.`,
    false:
      "A social image is set and has no alt text, or its alt text does not say what the image shows.",
  },
  target: "files",
  handle: { warn: { less_than: 0.6, message: "Add alt text for the social image." } },
};

export const rules: readonly RuleSchema[] = [
  has_call_to_action,
  is_description_complete,
  is_title_informative,
  has_image_alt_text,
];
