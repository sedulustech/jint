---
title: Release packaging - one version until a consumer forces one split
status: draft
modified: 2026-10-12
---

# Release packaging

How the workspace packages relate to releases and versions, now and when publishing opens.

## What exists today

Workspace packages, all `private: true`: `contract` (pure types, zero deps), one `rules/<domain>`
package per rule domain plus `rules` (the aggregate the cli bundles), `sdk` (the engine - measurement
semantics), `cli` (thin composition of sdk + rules + contract), `app` (the UI - embedded into
the cli binary at compile time, never a package). Internal dependencies are `workspace:*`. The
release process (tag push -> draft GitHub release with compiled binaries -> human edits notes ->
publish) ships the binary only; npm publish does not exist yet.

## Decision

One version for everything, always, until a specific external consumer (an SDK embedder or a
config-composing package user) forces exactly one split - and then that split is the only one.

`cli` stays `private` permanently: it ships as the compiled binary, a built artifact, not an npm
install. The tag version is the canon version - the binary release is the face. `app` stays
`private` permanently (embedded in the binary); `contract` publishes only beside `sdk`; the rule packages
stay private until a config author needs the package form.

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
- the rule packages - a config-composing user needs rule-content versioning independent of the engine.
  Publishing it adopts semver-for-rule-content: a threshold or instruction edit that changes
  findings is breaking.

Two splits at once is a version matrix nobody tests; the first real consumer defines the one
boundary that opens.

## Rejections

| what                                                             | why                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent per-package versions (changesets-style) from day one | A version matrix across coupled packages is a matrix of untested compatible-range combinations; for a measuring instrument it is a matrix of results. Bookkeeping cost with no consumer to pay for it.                                              |
| Pre-splitting sdk AND the rule domains speculatively             | Two independent drift axes from one cli is the untested matrix again. Drift is demand-driven, not potential-driven.                                                                                                                                 |
| Publishing the rule domains now with exact pins in the cli       | A permanent obligation (semver for rule content, a second release narrative) bought for a composition-skew that does not bite: past runs self-attribute, and `jint:rules/<domain>` already carries the compiled-in version authority in every home. |
| Aligning directory structure with publish boundaries             | Organization and publishing are independent axes; `private: true` is the only switch that decides what publishes. The tree stays shaped for the build.                                                                                              |

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

#### What npm scope, and how does `bunx` work against it?

Published packages go under the org scope: `@sedulus/jint` (+ `@sedulus/jint-<platform>` for the
binary packages). The bin name is separate from the package name:
the package registers `bin: { jint }`, so inside any project that depends on us `jint` and
`bunx jint` run OUR binary (local bin wins); only the one-off global spelling pays the scope
(`bunx @sedulus/jint`). Binary distribution on npm uses the optionalDependencies platform-package
pattern (meta-package + per-os/cpu binary packages; npm installs exactly the matching one) - no
postinstall downloads, no all-platforms bloat. npm publishes join the release fan-in AFTER the
human publishes the GitHub draft, at the tag's version, idempotently guarded.

#### What are the distribution channels, in what order?

Three, all serving the same tag (2026-10-12):

1. npm - `@sedulus/jint` meta-package + `@sedulus/jint-<platform>` binary packages via
   optionalDependencies (the package manager downloads exactly the matching os/cpu). The launcher
   shim is OURS, five lines - no binary-install-style wrapper dependency in the install path.
   `bunx @sedulus/jint` / `npm i -D @sedulus/jint` (project-local bin: `jint`).
2. install.sh - for machines with no JS runtime: `curl -fsSL <repo>/install.sh | bash`. The script
   is committed at the repo root, VERSIONLESS: it downloads from
   `releases/latest/download/jint-<os>-<arch>.tar.gz` (GitHub's permanent redirect to the newest
   published release - composes with the draft gate; latest never points at a draft). Verifies
   sha256 against `checksums.txt`, installs to `~/.local/bin`, whole script wrapped in `main() { }`
   with `set -euo pipefail` so a truncated download is a syntax error, not a half-run install.
3. GitHub Releases page - manual fallback, the signed/notarized tarballs themselves.

The build job emits `checksums.txt` (sha256 of every asset) alongside the tarballs. npm publish
and the script's URLs all resolve against the same tag's assets; no channel carries its own
version string. Pinned script installs: `VERSION=vX.Y.Z curl -fsSL .../install.sh | bash` - the
override swaps the `latest/download` redirect for `releases/download/${VERSION}/`, so pinning is
the caller's choice and the repo still contains zero version literals. `latest` is mutable by
design (two users, two times, possibly two binaries); reproducible installs pin - VERSION, the
npm exact pin, or the plain releases URL.

#### Which package could drift first?

Unknown until a consumer exists (2026-10-11). `sdk` is the likelier (embedding is the broader
use); the rule packages need the narrower config-author scenario. The first consumer decides, and that
split is then the only one.
