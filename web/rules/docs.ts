/**
 * Docs rules: what a page of docs/ says against what its front matter promises. Site-local, not an
 * official domain, and calibrated on this repo's docs only. Each rule reads one doc whole (front
 * matter and body) and is a defect question: a high reading is bad.
 *
 * The lacks_rule_link and has_code_comment rules read the nine use cases. Before the pages were
 * fixed the link rule read 0.79 to 1.00 on all nine; after, 0.05 to 0.50. The comment rule, on the
 * nine fixed pages, reads 0.00 for every page; on a real page with one comment planted it reads
 * 0.99 to 1.00 for four of five plants and 0.23 for the fifth, a standalone comment on the
 * effect-naming page (0.80 when the comment trails code on that page). So the comment rule misses
 * some comments on that page: both thresholds (warn 0.5, error 0.75) sit above its 0.23, so those
 * plants pass, and below the 0.99 to 1.00 of the other four. A noul threshold never goes below 0.5.
 * One site, nine pages.
 */

import type { RuleSchema } from "jint:sdk";

const docs = { target: "files" } as const;

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

export const has_extra_content: RuleSchema = {
  name: "has_extra_content",
  target: "files",
  instructions:
    "Besides its heading and the rule in a code block, does this use-case or example page say more than one short sentence about what the rule does?",
  criteria: {
    true: "The page says more than one short sentence of its own: it states where the rule ships or how to import it, shows an example of the code the rule judges, argues why a syntax check cannot do the job, or adds a section on calibration, readings or limits.",
    false:
      "Under its heading the page has one short sentence on what the rule does, and then the rule in a code block.",
  },
  handle: {
    warn: { greater_than: 0.5 },
    error: {
      greater_than: 0.7,
      message:
        "Say what the rule does in one sentence, then show the rule. Move the rest to Calibration.",
    },
  },
};

export const lacks_rule_link: RuleSchema = {
  ...docs,
  name: "lacks_rule_link",
  instructions:
    "A use-case page names its rule in the first sentence under its heading. Is that rule's name left without a link to the file that defines the rule, so a reader cannot find where the rule lives?",
  criteria: {
    true: "In the first sentence under the heading, the rule's name is plain code text, or it is a link to something other than a file in this repository: a page outside the repository, an anchor, or another doc.",
    false:
      "In the first sentence under the heading, the rule's name is a markdown link whose target is a relative path to the file in the repository that defines the rule.",
  },
  handle: {
    warn: { greater_than: 0.6 },
    error: {
      greater_than: 0.7,
      message: "Link the rule's name to the file that defines it, by a relative path.",
    },
  },
};

export const has_code_comment: RuleSchema = {
  ...docs,
  name: "has_code_comment",
  instructions:
    "A use-case page shows its rule in a TypeScript code block. Does that code block contain a literal comment: text after // on a line, or between /* and */? Look only for literal comments in the code. A mention of comments inside the rule itself, in its name, instructions or criteria, is fine.",
  criteria: {
    true: "A line of the TypeScript code block holds a literal comment outside any quoted string: // starts it, either on its own line or after code, or /* and */ surround it.",
    false:
      'The code block has no literal comment. The word comment in a rule name or in its quoted instructions and criteria is fine, and so are the characters /* or // inside a string, such as the glob "**/*.ts".',
  },
  handle: {
    warn: { greater_than: 0.5 },
    error: {
      greater_than: 0.75,
      message: "Remove the comment; the rule's name, instructions and criteria already say it.",
    },
  },
};

export const has_wordy_empty_cell: RuleSchema = {
  name: "has_wordy_empty_cell",
  kind: "noul",
  target: "markdown:table",
  instructions:
    "This unit is one markdown table. Does any cell say in words or symbols that it has no value, instead of holding a single hyphen (-)?",
  criteria: {
    true: "A cell stands for a missing or empty value but is written as something other than a single hyphen: the words none, n/a, no value or empty, a parenthesized (none), a dash such as an em dash, a blank cell, or a placeholder such as TBD.",
    false:
      "Every cell either holds a real value or holds a single hyphen for no value. A cell whose real value is the word none, such as an option or mode named none, is a value, not an empty cell.",
  },
  handle: {
    warn: { greater_than: 0.4 },
    error: {
      greater_than: 0.7,
      message: "Write a single hyphen (-) in a cell that has no value.",
    },
  },
};

/** Every rule of this set. */
export const rules: readonly RuleSchema[] = [
  has_description_mismatch,
  has_second_subject,
  has_extra_content,
  lacks_rule_link,
  has_code_comment,
  has_wordy_empty_cell,
];
