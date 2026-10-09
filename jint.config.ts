import { defaultRules, type RuleSpec } from "@jint/defaults";
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
const is_literal_shared: RuleSpec = {
  name: "is_literal_shared",
  kind: "choice",
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
  include: ["**/*.{ts,tsx,css}"],
  exclude: ["**/*.md", "**/*.lock"],
} as const;

export default defineConfig({
  rules: [...defaultRules, is_literal_shared],
  exclude: ["**/*.test.ts", "**/*.test-browser.tsx", "**/tests/**"],
});
