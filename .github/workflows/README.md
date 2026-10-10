# CI & Release

How code ships from this repository. Stateless: no dates, no versions, no history — the
workflow files are the source of truth for pins and triggers; this file describes the flow.

## CI

Every push to main and every PR runs the matrix build and the full test suite (serial on
purpose — the suite spawns processes, and a parallel run starves the tail on small runners).
Failures on main block nothing else; there is no auto-rollup.

## Release

1. Tag a `v*` version and push the tag.
2. The release workflow builds all binaries (linux on the ubuntu runner; both darwin targets
   cross-compiled, signed, and notarized on the macos runner), seeds the release notes from
   `git log <prev-tag>..<tag>` (commits grouped by scope prefix, EDIT-ME slots for the intro
   and Highlights), and creates a DRAFT release with the binaries attached.
3. Open the draft, edit the prose, press Publish. The tag is created at publish time; nothing
   is public before the click.

To dry-run: dispatch the release workflow (or push a throwaway `v*` tag), inspect the draft,
delete it with `gh release delete <tag> --cleanup-tag`.

To preview notes without creating anything:
`gh api -X POST repos/sedulustech/jint/releases/generate-notes -f tag_name=<version> -f target_commitish=<sha>`.

## Conventions

- Actions are pinned by full commit SHA; bumps move the pin and nothing else.
- Runner images and toolchains are pinned, never `-latest`.
- Merges never publish: only a tag push can start a release.
- Releases use the `gh` CLI (`--draft`, `--notes-file`, `--verify-tag`), not a release action.
