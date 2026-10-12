---
title: Release packaging - one version until a consumer forces one split
status: draft
modified: 2026-10-11
---

# Release packaging

How the workspace packages relate to releases and versions, now and when publishing opens.

## What exists today

Five workspace packages, all `private: true`: `contract` (pure types, zero deps), `defaults`
(declarative rules; source of the engine baseline), `sdk` (the engine - measurement
semantics), `cli` (thin composition of sdk + defaults + contract), `app` (the UI - embedded into
the cli binary at compile time, never a package). Internal dependencies are `workspace:*`. The
release process (tag push -> draft GitHub release with compiled binaries -> human edits notes ->
publish) ships the binary only; npm publish does not exist yet.

## Decision

One version for everything, always, until a specific external consumer (an SDK embedder or a
config-composing package user) forces exactly one split - and then that split is the only one.

`cli` stays `private` permanently: it ships as the compiled binary, a built artifact, not an npm
install. The tag version is the canon version - the binary release is the face. `app` stays
`private` permanently (embedded in the binary); `contract` publishes only beside `sdk`; `defaults`
stays private until a config author needs the package form.

`sdk` is the publish candidate - but the need it would serve is already met, for now, by the
virtual modules: rules authored against `jint:sdk` load and execute on jint's own runtime, so a
rule author needs no JS runtime, no install, no node_modules - only the binary. Publishing
`@jint/sdk` serves consumers OUTSIDE the config world: embedding the engine in another tool, or
authoring/testing rules with external tooling (a test runner, richer editor support). When npm
publish opens, whatever is not `private` publishes at the tag's version, with `workspace:*`
internal ranges rewritten to that version at pack time; the draft-then-publish process is
unchanged.

The two possible splits, when their consumer appears:

- `sdk` - an embedder (or external-tooling rule author) needs the package form and
  measurement-semantics versioning independent of cli features.
- `defaults` - a config-composing user needs rule-content versioning independent of the engine.
  Publishing it adopts semver-for-rule-content: a threshold or instruction edit that changes
  findings is breaking.

Two splits at once is a version matrix nobody tests; the first real consumer defines the one
boundary that opens.

## Rejections

| what                                                             | why                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent per-package versions (changesets-style) from day one | A version matrix across coupled packages is a matrix of untested compatible-range combinations; for a measuring instrument it is a matrix of results. Bookkeeping cost with no consumer to pay for it.                                        |
| Pre-splitting sdk AND defaults speculatively                     | Two independent drift axes from one cli is the untested matrix again. Drift is demand-driven, not potential-driven.                                                                                                                           |
| Publishing `defaults` now with exact pins in the cli             | A permanent obligation (semver for rule content, a second release narrative) bought for a composition-skew that does not bite: past runs self-attribute, and `jint:defaults` already carries the compiled-in version authority in every home. |
| Aligning directory structure with publish boundaries             | Organization and publishing are independent axes; `private: true` is the only switch that decides what publishes. The tree stays shaped for the build.                                                                                        |

## Definitions

- **lockstep** - every non-private package carries the same version and ships in the same
  release, from one repo tag.
- **split** - one package leaving lockstep for its own version cadence, forced by an external
  consumer of that package specifically.
- **canon version** - the single version number a release carries, read from the face package
  (`cli`).

## Questions

### Settled

#### Does the release workflow change when npm publish opens?

No (2026-10-11). One more job in the fan-in publishes the non-private set at the tag's version;
the draft gate and human publish step are unchanged.

#### Which package could drift first?

Unknown until a consumer exists (2026-10-11). `sdk` is the likelier (embedding is the broader
use); `defaults` needs the narrower config-author scenario. The first consumer decides, and that
split is then the only one.
