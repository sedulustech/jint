#!/usr/bin/env bash
# Install the jint binary from GitHub releases.
#
#   curl -fsSL https://github.com/sedulus/jint/install.sh | bash
#   VERSION=v1.2.3 curl -fsSL .../install.sh | bash   # pin to a release
#
# VERSIONLESS by design: the script carries no version literal - it resolves
# releases/latest/download/ (GitHub's permanent redirect to the newest published
# release; drafts never resolve), verifies the sha256 against checksums.txt, and
# installs the binary into ~/.local/bin.
#
# RELEASE_BASE is the test hook (defaults to https://github.com/sedulus/jint/releases):
# point it at a local file:// or http directory to stand in for GitHub releases.
# URLs are built as ${RELEASE_BASE}/latest/download/... or, with VERSION pinned,
# ${RELEASE_BASE}/download/${VERSION}/...

set -euo pipefail

main() {
  local base="${RELEASE_BASE:-https://github.com/sedulus/jint/releases}"
  if [ -n "${VERSION:-}" ]; then
    base="${base}/download/${VERSION}"
  else
    base="${base}/latest/download"
  fi

  # tmp is deliberately NOT local: the EXIT trap (below) still needs it after main returns
  local os arch tarball bin_dir
  tmp=""
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) echo "jint install: unsupported architecture: $(uname -m)" >&2; return 1 ;;
  esac
  case "$os" in
    linux|darwin) ;;
    *) echo "jint install: unsupported os: $os" >&2; return 1 ;;
  esac
  tarball="jint-${os}-${arch}.tar.gz"

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "downloading ${base}/${tarball}"
  curl -fsSL "${base}/${tarball}" -o "${tmp}/${tarball}"
  curl -fsSL "${base}/checksums.txt" -o "${tmp}/checksums.txt"

  # sha256sum (GNU) or shasum (macOS); only the downloaded tarball's line, since
  # checksums.txt covers every platform asset
  (
    cd "$tmp"
    grep "  ${tarball}$" checksums.txt \
      | { sha256sum -c - 2>/dev/null || shasum -a 256 -c -; }
  )

  tar -xzf "${tmp}/${tarball}" -C "$tmp"
  bin_dir="${HOME}/.local/bin"
  mkdir -p "$bin_dir"
  mv "${tmp}/jint" "${bin_dir}/jint"
  chmod +x "${bin_dir}/jint"
  echo "installed jint to ${bin_dir}/jint"

  case ":${PATH}:" in
    *":${bin_dir}":*) ;;
    *) echo "note: ${bin_dir} is not on your PATH - add 'export PATH=\"${bin_dir}:\$PATH\"' to your shell profile" ;;
  esac
  "${bin_dir}/jint" --version
}

main "$@"
