import { defaultRules, type RuleSchema } from "jint:defaults";
import { defineConfig } from "jint:sdk";

// the default package's rules, imported directly - the workspace-consumer path (design
// config-composition/03): the version is the workspace dependency, not the CLI baseline. The
// jint:defaults virtual module exists for external users and compiled binaries; this repo is
// neither. Test files are excluded: the rules calibrate on production code; structural test
// selectors are not their domain.
//
// Composition surface: defaultRules is the whole set; individual rules export under their own
// names for pick-and-override ({ ...is_greppable, include: ["src/**"] }).

// is_literal_shared: calibrated in packages/app, promoted repo-wide - NOT into the defaults (the
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
// language - NOT defaults-promoted; the two-language bar in AGENTS.md has not been met). The
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

export default defineConfig({
  rules: [...defaultRules, is_literal_shared, is_doc_stateful, is_headword_consistent],
  // The measured surface: source and styles. Prose, locks, tests, fixtures are not code with
  // values flowing between sites - the whole walk stops at the config level, not per rule. The
  // glossary rules reach GLOSSARY.md through their OWN rule include (the walk-union: discovery
  // admits a file when the config include OR any rule's include matches); every other md file
  // stays out by the config exclude, and is_literal_shared needs no per-rule carve-out - it
  // rides the config door, which never admits md.
  include: ["**/*.ts", "**/*.tsx", "**/*.css"],
  exclude: ["**/*.md", "**/*.test.ts", "**/*.test-browser.tsx", "**/tests/**", "**/*.lock"],
});
