# Releasing

How a release ships from this repository. Stateless: no dates, no versions, no history — the
workflow files are the source of truth for pins and triggers; this file describes the flow.

## Release

1. Tag a `v*` version and push the tag.
2. The release workflow builds all binaries (linux on the ubuntu runner; both darwin targets
   cross-compiled, signed, and notarized on the macos runner), seeds the release notes from
   `git log <prev-tag>..<tag> --oneline --no-merges` (one line per commit, EDIT-ME slot for
   the intro), and creates a DRAFT release with the binaries and their `checksums.txt`
   attached (what `install.sh` verifies against). A parallel job packs the npm tarballs
   (`@sedulus/jint` + platform packages) as workflow artifacts of the same run - packed,
   never attached; the publish job joins the fan-in only on tag builds, after the draft
   exists, idempotently guarded, with prereleases under the `rc` dist-tag.
3. Open the draft, keep the lines that matter (move them under Highlights or rewrite them
   as prose), delete the rest, press Publish. The tag is created at publish time; nothing
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

## Binaries mirror

Publishing a release also mirrors its binaries to the site, `/dl/` on the Cloudflare Pages
project in `web/`. The publish-binaries workflow runs on the Publish click, verifies
`checksums.txt`, and uploads to the `jint-releases` R2 bucket under `download/<tag>/` and
(stable releases only) `latest/download/`. The layout matches GitHub's, so
`RELEASE_BASE=<site>/dl` points `install.sh` at the mirror. The workflow needs the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.

The site's docs links, install command and beta trigger point at the `feat/decisions-model` branch,
which releases are tagged from for now. When that branch merges, run
`git grep feat/decisions-model` and change every hit back to `main`. `BRANCH` in
`web/src/lib/consts.ts` is the one const; the rest are literals (`_redirects`, the install
URLs, the workflow trigger).
