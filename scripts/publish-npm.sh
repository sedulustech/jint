#!/usr/bin/env bash
# Publish the packed npm tarballs (dist-npm/) at the tag's version.
# Idempotent by design: a version already on the registry is skipped, so a
# retried release run is a no-op, not a version-bump bookkeeping session.
# Dist-tag: prerelease versions (vX.Y.Z-rc.N and friends) publish under the
# 'rc' tag so 'latest' never points at a rehearsal; stable X.Y.Z owns latest.
set -euo pipefail

dry_run=""
if [ "${NPM_PUBLISH_DRY_RUN:-}" = 1 ]; then dry_run="--dry-run"; fi

dist_dir="${1:?usage: publish-npm.sh <dist-dir>}"

for tgz in "$dist_dir"/*.tgz; do
  name=$(tar -xzOf "$tgz" package/package.json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).name)')
  version=$(tar -xzOf "$tgz" package/package.json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).version)')
  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "$name@$version already published - skipping"
    continue
  fi
  case "$version" in
    *-*) tag=rc ;;
    *) tag=latest ;;
  esac
  echo "npm publish $tgz --tag $tag$dry_run"
  npm publish "$tgz" --tag "$tag" $dry_run
done
