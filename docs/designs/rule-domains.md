---
title: Rule domains - one package per domain, no default set
status: implemented
modified: 2026-10-29
---

# Rule domains

How the shipped rules are grouped, imported and run, now that there is no default rule set.

## Decision

Rules are grouped by domain. A domain is a named group of rules and one workspace package
(`packages/rules-<domain>`), imported as `jint:rules/<domain>`. A domain exports each rule under
its own name and the whole group as `rules`. The domains are `comments`, `complexity`, `errors`
and `naming`.

A domain is a subject, not a layer. It names a property judged (comments, naming) or a technology
(typescript, react); a language is a technology, so it is a domain too. A domain may nest
subdomains (`comments/typescript`). A subdomain adds rules or examples for one technology and never
rewords its parent's questions: the question is the rule, and a reworded question is a different
rule that needs its own calibration. A subdomain is a subpath of the parent's package, never a
package of its own.

jint runs only the rules a config names. A run with no config, or a config with no rules, fails
with the domains and the rules in each, plus the smallest working config. The error is written
for an agent that reads it and writes a config for the codebase it is in. `jint capture`
classifies nothing and needs no rules.

A rule name that appears twice in a config is an error naming both entries. A later entry that sets
`override: true` replaces the earlier one, and `override: true` with nothing to replace is an
error too. Nothing wins by position.

## Why

- A flat default set grows without bound, and every project pays for every rule on every run.
- One package per domain lets a domain gain an owner, a cadence and, later, a publish boundary
  without a change to any import path.
- The import path mirrors the package, so an agent finds a rule by its subject.

## Rejections

| what                                              | why                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A small default set that composes some domains    | Choosing it is the problem this removes; a config that names its rules is explicit and reviewable.     |
| Last entry wins on a repeated rule name           | Order-dependent config is the bug an agent writes; the override is spelled out instead.                |
| A per-domain version file and a `requires` check  | The pin is the package version. The check is complexity bought before a second publish channel exists. |
| `jint:comments` (no `rules/` segment)             | One namespace for tooling (`jint:sdk`) and rules means every new domain must avoid the tooling names.  |
| Language as the top level (`typescript/comments`) | The same property would split across every language directory, and calibration would pool by language. |

## Questions

### Open

- Where official domains are published and how a config pulls and pins one. Until then they ship in
  the CLI.
- What a domain must show to be official: the healthy-max / defective-min gap per language
  (AGENTS.md, "Adding rules to a domain") is the current bar.
- A check that a subdomain's question text matches its parent's. No subdomain exists yet.
