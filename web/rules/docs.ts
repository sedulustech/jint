/**
 * Docs rules: what a page of docs/ says against what its front matter promises. Site-local, not an
 * official domain, and calibrated on this repo's docs only. Each rule reads one doc whole (front
 * matter and body) and is a defect question: a high reading is bad.
 */

import type { RuleSchema } from "jint:sdk";

const docs = {
  target: "files",
  include: ["**/*.md"],
  exclude: ["designs/**"],
} as const;

export const has_description_mismatch: RuleSchema = {
  ...docs,
  name: "has_description_mismatch",
  instructions:
    "Does this page's front-matter title or description promise something the page does not deliver, or leave out a main subject the page covers?",
  criteria: {
    true: "The description or title names a subject the body does not cover, or the body spends most of its length on a subject the description never mentions.",
    false:
      "The description and title state what the body covers. A description that is shorter than the page, or that omits a minor section, is not a mismatch.",
  },
  handle: {
    warn: { greater_than: 0.6 },
    error: { greater_than: 0.8, message: "Make the description say what the page covers." },
  },
};

export const has_second_subject: RuleSchema = {
  ...docs,
  name: "has_second_subject",
  instructions:
    "Does this page cover a second subject that a reader would look for under its own title?",
  criteria: {
    true: "Besides the subject its title names, the page has a section of its own on a different subject, one that could stand as a separate page and that a reader would not expect under this title.",
    false:
      "Every section serves the subject the title names. A short pointer to a related page, or an example drawn from another area, is not a second subject.",
  },
  handle: {
    warn: { greater_than: 0.6 },
    error: { greater_than: 0.8, message: "Move the second subject to its own page." },
  },
};

/** Every rule of this set. */
export const rules: readonly RuleSchema[] = [has_description_mismatch, has_second_subject];
