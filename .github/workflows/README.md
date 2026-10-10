# CI & Release decisions

The workflows in this directory and the decisions behind them. Written 2026-10-10, after the
release-path design conversation; update it when a decision changes, not when code does.

## The three workflows

| file                | trigger                          | job                                                                                |
| ------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| `ci.yml`            | push/PR to main, manual dispatch | matrix build + full test suite                                                     |
| `sign-notarize.yml` | manual dispatch only             | darwin cross-compile, sign, notarize, Gatekeeper-verify — the credential-proof leg |
| `release.yml`       | tag push (`v*`), manual dispatch | build all three targets, attach to a GitHub Release                                |

## Decisions

### Releases use `gh release create`, not a release action

The release step is a plain run step calling the preinstalled `gh` CLI with `--generate-notes`.
Reasons:

- **Automated notes are an API feature, not the action's.** `--generate-notes` and
  `softprops/action-gh-release`'s `generate_release_notes: true` hit the same endpoint and
  produce the identical body. Nothing is lost by dropping the action.
- **One less third-party action** with `contents: write` over the repo: no SHA to pin, no
  Node-runtime deprecation to track (softprops `@v2` is the deprecated Node 20 branch; `@v3`
  exists — that was the alternative), failures are ordinary CLI exit codes.
- Extra knobs the action doesn't surface: `--notes-start-tag` (bound the changelog range),
  `--verify-tag` (fail if the tag doesn't match the checkout), `--prerelease`.

Drafts are invisible to the public; the disposable-tag protocol below relies on that.

### Actions are pinned by full commit SHA

Mutable tags (`@v5`) can be repointed by a compromised upstream. Every `uses:` carries the
immutable SHA with the readable tag in a comment (the CI logs print the resolved SHA anyway —
pinning freezes what already runs). Applies to `checkout`, `setup-bun`, `upload-artifact`.

### Runner images are pinned, not `-latest`

`ubuntu-24.04` not `ubuntu-latest` (migrates to 26.04 on 2026-10-19; builds must stay
reproducible across the switch). `macos-26` resolves to the macOS 26 arm64 image the first
green matrix ran on; `macos-15-arm64` sat in a contended queue, `macos-14` is deprecated.

### Bun is pinned to `1.4.x`

A second Bun leg added concurrency and flake surface, not signal — setup-bun's `latest`
resolved to the same line anyway.

### Tests run serially in CI

Nearly every case spawns its own CLI process; the 2-vCPU runner starves the tail-most spawn
under `--parallel` (surfaced as 5000ms timeouts). The suite is process-bound, not CPU-bound.

### Tags are the only release trigger

CI (main pushes) and CD (tag pushes) are decoupled: a merge can never publish. This is the part
of the "environments/OIDC" best-practice bundle that applies here. The rest does not: OIDC
eliminates long-lived _cloud_ credentials and we have none (the Apple p8 key is not
replaceable by OIDC). A GitHub Environment with a required reviewer on the release job is the
noted future guard for installer-delivered binaries — deliberately skipped while solo.

### Release tags should be seeded with `--notes-start-tag`

The repo has no early tags, so the FIRST generated notes body covers the entire history. Either
accept that for `v0.1.0` or pass `--notes-start-tag` once an earlier tag exists.

## The release flow

1. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`.
2. `release.yml` builds all three binaries, seeds the notes from `git log <prev-tag>..TAG`
   (commits grouped by scope prefix, EDIT-ME slots for intro and Highlights), and creates a
   DRAFT release with the binaries attached.
3. You open the draft, edit the prose in the browser, and press Publish — the tag is created at
   publish time and nothing is public before the click.
4. Disposable dry run: dispatch the workflow (or push a `v0.0.0-test.1` tag), inspect the
   draft, delete it with `gh release delete <tag> --cleanup-tag`.

Notes can be previewed locally without creating anything:
`gh api -X POST repos/sedulustech/jint/releases/generate-notes -f tag_name=v0.1.0 -f target_commitish=<sha>`.
For a push-only history that endpoint yields only a Full Changelog link (it lists PRs, not
commits), which is why the seed is a local `git log` parse instead.

## Notes on the darwin leg

`scripts/build.ts` cross-compiles both darwin targets on one arm64 runner. Signing uses the
Developer ID identity from `APPLE_P12_BASE64`/`APPLE_P12_PASSWORD`; notarization uses an App
Store Connect API key (`APPLE_API_KEY_*`, `APPLE_ISSUER_ID`) rather than Apple ID + app
password — revocable, org-scoped, no 2FA in CI. No stapling: the artifact is a bare Mach-O in
the release, and Gatekeeper fetches the ticket online on first run (`spctl -a -t open` is the
assessment that applies to a plain executable).

The workflow lives at `sign-notarize.yml` and its steps are the proven-green source for
`release.yml`'s darwin job (two green runs 2026-10-05).
