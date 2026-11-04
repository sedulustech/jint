/**
 * Open Graph rules: how a page presents itself where it is shared - the title, the description and
 * the social image. A domain of its own, not an official one: it was calibrated on this site alone
 * (Astro), so it stays with the site until it has met another page layout.
 *
 * The lengths a metadata checker counts (a title of 50-60 characters) are a plain script's job and
 * are not here. These rules judge what a count cannot: whether the copy says anything. Each rule
 * reads one file whole, so it applies to any file that sets a page's tags (.astro, .html) and reads
 * true on a file that sets none. A high reading is good.
 */

import type { NoulRuleSchema, RuleSchema } from "@jint/contract";

const files = ["**/*.astro", "**/*.html"];

const NOT_APPLICABLE =
  "This file sets no page title, description or social image, so there is nothing to judge.";

export const has_call_to_action: NoulRuleSchema = {
  name: "has_call_to_action",
  instructions:
    "Does the page's description or title tell the reader what to do or what they get next, beyond naming the product?",
  criteria: {
    true: `${NOT_APPLICABLE} Otherwise the description or title invites an action or names an outcome the reader can expect: install it, read the guide, try it, get something specific.`,
    false:
      "The description or title only names or characterizes the product (a tagline, a category label) and gives the reader no action to take and no outcome to expect.",
  },
  target: "files",
  include: files,
  handle: {
    warn: { less_than: 0.6, message: "Say what the reader can do or get in the description." },
  },
};

export const is_description_complete: NoulRuleSchema = {
  name: "is_description_complete",
  instructions:
    "Does the page's description say what the page is, who or what it is for, and what the reader gets, in a sentence or two?",
  criteria: {
    true: `${NOT_APPLICABLE} Otherwise the description covers what the page is, who or what it is for, and what the reader gets, in full sentences.`,
    false:
      "The description leaves out at least one of these: what the page is, who or what it is for, what the reader gets. A slogan or a fragment of a sentence is not complete.",
  },
  target: "files",
  include: files,
  handle: {
    warn: {
      less_than: 0.6,
      message: "Write a description that says what, for whom and what you get.",
    },
  },
};

export const is_title_informative: NoulRuleSchema = {
  name: "is_title_informative",
  instructions:
    "Does the page's title say what the page is about, with more than the product name and a category?",
  criteria: {
    true: `${NOT_APPLICABLE} Otherwise the title names the page's subject or the reader's gain, so a reader tells this page from the product's others.`,
    false:
      "The title is the product name with a category or a generic word (a brand and a label), and says nothing about what this page offers.",
  },
  target: "files",
  include: files,
  handle: { warn: { less_than: 0.6, message: "Put what this page is about in the title." } },
};

export const has_image_alt_text: NoulRuleSchema = {
  name: "has_image_alt_text",
  instructions:
    "Does the social image have alt text that says what the image shows, including any text printed on it?",
  criteria: {
    true: `This file sets no social image, or it sets one with alt text (og:image:alt or twitter:image:alt) that says what the image shows, and states any text printed on it.`,
    false:
      "A social image is set and has no alt text, or its alt text does not say what the image shows.",
  },
  target: "files",
  include: files,
  handle: { warn: { less_than: 0.6, message: "Add alt text for the social image." } },
};

/** Every rule of this domain. */
export const rules: readonly RuleSchema[] = [
  has_call_to_action,
  is_description_complete,
  is_title_informative,
  has_image_alt_text,
];
