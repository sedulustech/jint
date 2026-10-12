#!/usr/bin/env bash
# One-off verification of install.sh - run after touching it or before a release.
#
#   scripts/verify-install.sh [tag]                    # stages from GitHub (default: latest)
#   RELEASE_STAGE=dir scripts/verify-install.sh tag    # stages from a local directory
#
# Stages the release tarballs + checksums behind a local http server (stand-in for
# GitHub releases), then drives install.sh through every branch: happy path,
# wget-only PATH, tampered tarball, darwin x64 selection, Rosetta translation,
# musl rejection, broken/missing ldd, --help. Non-running tarballs (arm64, darwin)
# are re-tarred with a stub `jint` member so each branch completes on a linux host.
# Exits nonzero if any branch misbehaves.

set -euo pipefail

REPO=${GITHUB_REPOSITORY_OVERRIDE:-sedulustech/jint}
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
INSTALL="$SCRIPT_DIR/../install.sh"
TAG=${1:-latest}

work=$(mktemp -d)
SERVER_PID=""
trap 'kill $SERVER_PID 2>/dev/null || true; rm -rf "$work"' EXIT
stage="$work/download/$TAG"
mkdir -p "$stage" "$work/latest/download"

if [ -n "${RELEASE_STAGE:-}" ]; then
  echo "staging from $RELEASE_STAGE"
  cp "$RELEASE_STAGE"/* "$stage/"
else
  echo "staging $TAG from github.com/$REPO"
  for f in jint-linux-x64.tar.gz jint-linux-arm64.tar.gz jint-darwin-x64.tar.gz jint-darwin-arm64.tar.gz checksums.txt; do
    url="https://github.com/$REPO/releases/download/$TAG/$f"
    curl -fsSL "$url" -o "$stage/$f" || { echo "FAIL: cannot stage $f ($url)"; exit 1; }
  done
fi

# the running tarball (linux-x64) is used as-is; the others get a stub member so
# the final --version exec works on a linux host (checksums regenerated to match)
stub=$work/stub-jint
printf '#!/bin/sh\necho "stub 0.0.0"\n' > "$stub"
chmod +x "$stub"
retar=$work/retar && mkdir -p "$retar" && cp "$stub" "$retar/jint"
for t in linux-arm64 darwin-x64 darwin-arm64; do
  tar -czf "$stage/jint-$t.tar.gz" -C "$retar" jint
done
(cd "$stage" && sha256sum *.tar.gz > checksums.txt)
cp "$stage"/* "$work/latest/download/"

# stub-bin trees that steer install.sh's platform/libc detection:
# real tools first (symlinks), then stubs overwrite what a branch needs
mkstub() { rm -rf "$work/$1" && mkdir -p "$work/$1"; }
for d in base darwin rosetta musl brokenldd noldd wgetonly; do
  mkstub "$d"
  for t in bash tar gzip mktemp grep sha256sum rm mv mkdir chmod cat tr wget curl uname sysctl ldd; do
    p=$(command -v "$t") && ln -sf "$p" "$work/$d/$t"
  done
done
rm -f "$work/base/uname" "$work/rosetta/sysctl" "$work/musl/ldd" "$work/brokenldd/ldd"
cat > "$work/base/uname" <<'EOF'
#!/bin/sh
case "$1" in
  -s) echo "${FAKE_UNAME_S:-Linux}" ;;
  -m) echo "${FAKE_UNAME_M:-x86_64}" ;;
esac
EOF
printf '#!/bin/sh\necho 1\n' > "$work/rosetta/sysctl"
printf '#!/bin/sh\necho musl \(x86_64\)\necho Version 1.2.5\nexit 0\n' > "$work/musl/ldd"
printf '#!/bin/sh\necho some-weird-libc v9\nexit 1\n' > "$work/brokenldd/ldd"
chmod +x "$work/base/uname" "$work/rosetta/sysctl" "$work/musl/ldd" "$work/brokenldd/ldd"
# branch shape: fake uname where the branch needs it, real elsewhere
for d in darwin rosetta; do rm -f "$work/$d/uname"; cp "$work/base/uname" "$work/$d/uname"; done
cp -r "$work/base"/. "$work/wgetonly/" 2>/dev/null || true
rm -f "$work/wgetonly/curl" "$work/wgetonly/uname"
ln -sf "$(command -v uname)" "$work/wgetonly/uname"
rm -f "$work/darwin/sysctl" "$work/rosetta/ldd" "$work/noldd/ldd"

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
(cd "$work" && python3 -m http.server "$PORT" >/dev/null 2>&1) &
SERVER_PID=$!
sleep 1
BASE="http://127.0.0.1:$PORT"
HOME_OVERRIDE=$work/home && mkdir -p "$HOME_OVERRIDE"

pass=0; fail=0
run() { # run <name> <want-exit> <want-grep|-> <path-dir> [extra env VAR=val...]
  local name=$1 want=$2 pattern=$3 dir=$4; shift 4
  local out code
  out=$(env -i HOME="$HOME_OVERRIDE" RELEASE_BASE="$BASE" VERSION="$TAG" PATH="$work/$dir" "$@" bash "$INSTALL" 2>&1) && code=0 || code=$?
  if [ "$code" = "$want" ] && { [ "$pattern" = - ] || echo "$out" | grep -q "$pattern"; }; then
    echo "PASS $name"; pass=$((pass+1))
  else
    echo "FAIL $name (exit=$code want=$want) :: $(echo "$out" | tail -1)"; fail=$((fail+1))
  fi
}

run "happy path"           0 "installed jint to"        base
run "wget-only PATH"       0 "installed jint to"        wgetonly
run "darwin selects x64"   0 "jint-darwin-x64.tar.gz"   darwin FAKE_UNAME_S=Darwin
run "rosetta -> arm64"     0 "jint-darwin-arm64.tar.gz" rosetta FAKE_UNAME_S=Darwin
run "musl rejected"        1 "musl libc"                musl
run "broken ldd refused"   1 "cannot determine the libc" brokenldd
run "missing ldd refused"  1 "cannot determine the libc" noldd

# tamper: corrupt the staged tarball, expect the checksum to catch it
printf 'corrupt' >> "$stage/jint-linux-x64.tar.gz"
run "tampered checksum"   1 "FAILED"                    base

if bash "$INSTALL" --help | grep -q Usage; then echo "PASS --help"; pass=$((pass+1)); else echo "FAIL --help"; fail=$((fail+1)); fi

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
