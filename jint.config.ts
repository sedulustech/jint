import { rules as comments } from "jint:rules/comments";
import { rules as complexity } from "jint:rules/complexity";
import { rules as errors } from "jint:rules/errors";
import { rules as naming } from "jint:rules/naming";
import { rules as reactHooks } from "jint:rules/react/hooks";
import { has_sensitive_value } from "jint:rules/security";
import { defineConfig, type RuleSchema } from "jint:sdk";

// Every rule domain, through the jint:rules/<domain> virtual modules. Test files are excluded: the
// rules calibrate on production code; structural test selectors are not their domain.
//
// Composition surface: a domain's `rules` is the whole domain; individual rules export under their
// own names for pick-and-override ({ ...is_greppable, include: ["src/**"], override: true } when the
// name is already in the list).

// is_literal_shared: calibrated in packages/app, promoted repo-wide - NOT into an official domain (the
// two-language promotion bar in AGENTS.md has not been met). Markdown and lockfiles stay out:
// prose and lock data are not code with values flowing between sites.
const is_literal_shared: RuleSchema = {
  name: "is_literal_shared",
  kind: "score",
  target: "files",
  instructions:
    "This unit is a source file. This file might contain literal values (string, number, etc) carrying the same value at two or more separate places. A shared value should be written once as a named constant in this file and referenced at each place: an identical raw literal at distinct sites is drift waiting to happen.",
  criteria: [
    "No raw literal flows between sites: every repeated literal is either a named constant carried to all its sites, or a per-site use of a shared vocabulary - a styling class string, a prop or option value, an event, sort-key or mode name, a typeof guard comparison string, an error-code name - where each site names the convention. Brevity of a literal alone is not a defect; imports and identifiers are not literals.",
    "Repeated literals are convention vocabulary or typeof guards, however numerous; at most one or two are ambiguous - plausibly a convention, plausibly one value flowing between sites that wants a constant.",
    "At least one literal value appears as the same raw literal in two or more distinct places where the sites share that value, and no single named constant in this file carries it to all of them. Convention words do not count even when numerous: typeof guard strings, styling classes, prop/event/mode names, error-code names - those are per-site uses of a vocabulary, not a value flowing.",
    "Pervasive: multiple distinct values repeat as raw literals across their sites with no constants, so several renames would miss sites.",
  ],
  handle: { map: ["pass", "pass", "warn", "error"] },
};

// is_doc_stateful: glossary discipline, calibrated in-repo on GLOSSARY.md (2026-10-19, one
// language - NOT promoted into a domain; the two-language bar in AGENTS.md has not been met). The
// defect has two species with one remedy: history/session narration, and pinned mutable facts
// (counts, inventories, defaults) a code change silently falsifies. A score split of the two
// was tried and reverted: not separable at definition granularity without paying precision,
// and the fixer action is identical - see the handle message.
const is_doc_stateful: RuleSchema = {
  name: "is_doc_stateful",
  kind: "noul",
  target: "markdown:list_item",
  instructions:
    "This unit is one definition in a project glossary (one list entry). Does this definition depend on when or where it is read, or on facts about the system that a code change can alter?",
  criteria: {
    true: "This definition is stateful: it depends on when or where it is read. It says currently, recently, we just, or otherwise refers to session history (a rename, a past state, the old X), or it uses a pronoun whose antecedent lives outside this entry. The definition also pins a mutable fact about the system - a count, an inventory, a default, a current implementation convention - that a change to the code would silently falsify.",
    false:
      "The definition is stateless: it could be read at any time, in any order, with no other entry open, and mean exactly the same thing - like a dictionary definition. A definition that names what the system IS, without pinning how many or which, stays stateless.",
  },
  include: ["GLOSSARY.md"],
  handle: {
    warn: {
      greater_than: 0.5,
      message:
        "Remove mentions that are not the definition itself: no currently/recently/we-just, no session history (renames, past states, the old X), no pronouns whose antecedent lives outside the entry, and no pinned mutable facts (counts, inventories, defaults, current conventions). This should read like a dictionary definition, not documentation of past events or a snapshot of the system.",
    },
    error: {
      greater_than: 0.65,
      message:
        "Remove mentions that are not the definition itself: no currently/recently/we-just, no session history (renames, past states, the old X), no pronouns whose antecedent lives outside the entry, and no pinned mutable facts (counts, inventories, defaults, current conventions). This should read like a dictionary definition, not documentation of past events or a snapshot of the system.",
    },
  },
};

// is_headword_consistent: same session, same file - the term list mixes shapes (single words,
// vs-pairs, multi-word phrases) and reads 0.47-0.54 (a true split). Thresholds parked high
// until a decision on whether mixed headword shapes are a defect or honest vocabulary breadth.
const is_headword_consistent: RuleSchema = {
  name: "is_headword_consistent",
  kind: "noul",
  target: "markdown:list",
  instructions:
    "This unit is one list of glossary entries: each entry is a dash, a bolded headword, an em dash, then the definition. Headwords are the bolded phrases before the em dashes - the terms the entries define. Do all the headwords in this list share one format?",
  criteria: {
    true: "At least one headword in this list does not match the format of the other headwords: a different casing style, a multi-word or qualified phrase among single words, a slash-joined pair among plain words, or some other entry whose bolded term is shaped unlike the rest.",
    false:
      "Every headword in this list shares the same format: same casing style, same shape (single word, phrase, or pair), so the term list reads as one vocabulary.",
  },
  include: ["GLOSSARY.md"],
  handle: {
    warn: {
      greater_than: 0.9,
      message:
        "At least one headword is shaped unlike the rest: make the term list one vocabulary - same casing style, same headword shape.",
    },
    error: {
      greater_than: 0.95,
      message:
        "At least one headword is shaped unlike the rest: make the term list one vocabulary - same casing style, same headword shape.",
    },
  },
};

// is_comment_contradictory: a comment that states something the code in the same file contradicts,
// first seen when install.sh's header still described GitHub releases after the code fetched the
// site. Target files, because the comments targets measure only comments a definition owns: a
// file header is a loose comment, so no comments rule ever saw it. Calibrated on bash only (the
// two-language bar in AGENTS.md has not been met, so NOT in an official domain), with the rule
// scoped to .sh until a second language is measured: healthy 0.03 and 0.29 (the two repo scripts,
// fixed), defective 0.98 (the stale header) and 0.64 (a stub comment gone stale in
// verify-install.sh), and 1 fire in 10 real scripts (0.79, a trailing comment naming a GUI the
// call runs without). The error bar sits at 0.9 so only a blatant contradiction errors.
const is_comment_contradictory: RuleSchema = {
  name: "is_comment_contradictory",
  kind: "noul",
  target: "files",
  instructions:
    "This unit is one source file. Does any comment in this file state something about what the code does, where it reads from, or how it is used, that the code in this same file contradicts?",
  criteria: {
    true: "At least one comment makes a claim the code in this file contradicts: it names a source, destination, default, option, command or behavior that the code does not have or has changed - a header describing an old download location, a usage line for a flag the code no longer reads, a doc comment promising a return the body never makes. A comment that is merely vague, narrates the obvious, or is out of date about something the file does not show is not a contradiction.",
    false:
      "Every comment is consistent with the code: what it claims about behavior, defaults, options and usage is what the code does, or it makes no checkable claim about the code at all.",
  },
  include: ["**/*.sh"],
  handle: {
    warn: { greater_than: 0.5 },
    error: {
      greater_than: 0.9,
      message:
        "A comment says something the code in this file contradicts: fix the comment or the code.",
    },
  },
};

// is_comment_stateful: a comment that reads true only today - now, currently, no longer, a date, a
// review, the old X. Target comments, so a reading names the definition to rewrite. Calibrated on
// TypeScript only (the two-language bar in AGENTS.md has not been met, so NOT in an official
// domain; scoped to .ts/.tsx): 10 of 170 definitions fire (0.52 to 1.0) over seven core files as
// they stood before their comments were stripped, and all 10 carry a date, a review id, a retired
// name or a "was/old" history. No healthy unit crossed 0.5 (next highest 0.44).
const is_comment_stateful: RuleSchema = {
  name: "is_comment_stateful",
  kind: "noul",
  target: "comments",
  instructions:
    "Does any comment in this unit depend on when it is read? Judge only the comments, not the code.",
  criteria: {
    true: "At least one comment is stateful: it says now, currently, recently, no longer, used to, previously or we just, or it narrates history (a rename, a removed feature, a past bug, a review or a date, the old X) instead of what the code is. Read a year later, or by someone who never saw the change, it would be wrong or meaningless.",
    false:
      "Every comment is stateless: it says what the code does or why, in terms that hold at any time and need no memory of how the code got here.",
  },
  include: ["**/*.ts", "**/*.tsx"],
  handle: {
    warn: { greater_than: 0.5 },
    error: {
      greater_than: 0.8,
      message:
        "Rewrite this comment so it reads the same at any time: no now, currently or no longer, no history of the change.",
    },
  },
};

export default defineConfig({
  rules: {
    // The measured surface: source and styles. Prose, locks, tests, fixtures are not code with
    // values flowing between sites - the whole walk stops at the config level, not per rule. The
    // glossary rules reach GLOSSARY.md through their OWN rule include (the walk-union: discovery
    // admits a file when this include OR any rule's include matches); every other md file
    // stays out by this exclude, and is_literal_shared needs no per-rule carve-out - it
    // rides the config door, which never admits md.
    include: ["**/*.ts", "**/*.tsx", "**/*.css", "**/*.sh"],
    exclude: ["**/*.md", "**/*.test.ts", "**/*.test-browser.tsx", "**/tests/**", "**/*.lock"],
    use: [
      ...comments,
      ...complexity,
      ...errors,
      ...naming,
      ...reactHooks,
      is_literal_shared,
      is_doc_stateful,
      is_headword_consistent,
      is_comment_contradictory,
      is_comment_stateful,
      // the domain rule claims every json, toml and yaml file; lockfiles, the built site and fixtures
      // (fake values on purpose) are not config
      {
        ...has_sensitive_value,
        exclude: ["**/bun.lock", "**/package-lock.json", "web/dist/**", "**/fixtures/**"],
      },
    ],
  },
});
