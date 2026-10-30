---
title: Config import specifiers - jint:* virtuals, not bare interception
status: implemented
modified: 2026-10-11
---

# Config import specifiers

What a jint.config.ts may import to reach the rule domains, and what each
specifier form means in each home.

## What exists today

- `jint:sdk` and `jint:rules/<domain>` - virtual modules the config loader registers via
  `Bun.plugin` (`build.module`) in EVERY home: workspace checkout, npm install, compiled binary.
  Editor types via ambient declarations (`sdk.d.ts`, `rules.d.ts`, pinned by test). A domain's
  surface is `rules` (its ordered specs) plus each rule under its own name. Before the domain
  split the surface was one `jint:defaults` module; see rule-domains.md.
- `@jint/rules-<domain>` / `@jint/sdk` / `@jint/contract` - real workspace packages (private, not
  published). Resolvable through `node_modules` wherever one exists; each domain package is the
  declarative source the CLI's catalog compiles from.

## Decision

`jint:*` is the portable, config-facing spelling. Everything we document, exemplify, or generate
uses `jint:rules/<domain>` / `jint:sdk`. It works in every home with zero interception and cannot
resolve anywhere but us - a scheme specifier is outside the npm namespace, never walks
`node_modules`, and cannot be shadowed by a user install or squatted on npm.

`@jint/*` stays a workspace-internal package form until the publishing decision opens. In homes
with `node_modules` it resolves through it (a user's install is their dependency); inside a
compiled binary it is UNRESOLVABLE, and we do not intercept it.

Version authority: inside a binary, each `jint:rules/<domain>` virtual serves the specs compiled into
that binary. The CLI bump IS the rules bump - no accidental rule skew, by construction. In
non-embedded homes the engine's baseline is the fallback; whatever the config composes from its
own imports IS what runs (specs flow from config to engine). Two copies of the default specs in
one process (engine baseline + config-composed set) is intended node semantics, not a defect.

Past runs self-attribute (the report carries the rule set it ran); recalibration when rule content
changes is a release duty ("editing a criteria line is a recalibration event"), so no rules
fingerprint in the manifest is needed now.

## Rejections

| what                                                                                                                        | why                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intercept bare `@jint/*` specifiers inside the compiled binary (`build.module("@jint/rules-comments")`, embedded home only) | Bare-specifier interception is the collision-prone pattern the ecosystem avoids: one specifier, two meanings (disk in one home, embedded in another) - the dual meaning the colon scheme exists to prevent. Shipped as 1cd8117, reverted the same day. The problem it solved (bare import failing under `$bunfs`) was self-inflicted: configs should import `jint:defaults`, which already worked everywhere. |
| Publish `@jint/rules-<domain>` with exact pins in the CLI                                                                   | Publishing is a permanent obligation (semver for rule content, a second release channel) bought to solve a composition-skew the record shows is benign. Deferred until an external user actually needs to import the package.                                                                                                                                                                                 |
| Rules fingerprint (hash of compiled specs) in the run manifest                                                              | Solves an attribution problem that does not bite: past runs self-attribute, future runs are covered by release-time recalibration duty. Revisit if cross-run comparability ever needs machine-readable rule identity.                                                                                                                                                                                         |

## Definitions

- **virtual module** - a module the tool's loader resolves itself; never read from disk. Declared
  for editors with `declare module` ambient files.
- **scheme specifier** - an import with a `tool:` URI scheme (`node:`, `bun:`, `jint:`); outside
  the npm namespace by construction.
- **bare specifier** - an npm package name form (`@jint/rules-comments`); owned by node_modules
  resolution semantics, anyone can publish it.
- **home** - where jint runs from: workspace checkout, npm-installed CLI, or compiled binary
  (`$bunfs`, no `node_modules`).

## Questions

### Settled

#### Which spelling is portable in config files?

`jint:rules/<domain>` (2026-10-11, was `jint:defaults`). Works in every home, cannot be shadowed, types already shipped.

#### Do we intercept bare `@jint/*` in binaries?

No (2026-10-11). Reverted; see Rejections.

#### When do we publish `@jint/rules-<domain>`?

Not yet (2026-10-11). Until an external user needs the package form; the publishing decision is
its own future design.
