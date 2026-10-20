#!/usr/bin/env bash
# Install the jint binary from GitHub releases.
#
#   curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/main/install.sh | bash
#   curl -fsSL .../install.sh | VERSION=v1.2.3 bash   # pin to a release
#
# VERSIONLESS by design: the script carries no version literal - it resolves
# releases/latest/download/ (GitHub's permanent redirect to the newest published
# release; drafts never resolve), verifies the sha256 against checksums.txt, and
# installs the binary into ~/.local/bin.
#
# RELEASE_BASE is the test hook (defaults to https://github.com/sedulustech/jint/releases):
# point it at a local file:// or http directory to stand in for GitHub releases.
# URLs are built as ${RELEASE_BASE}/latest/download/... or, with VERSION pinned,
# ${RELEASE_BASE}/download/${VERSION}/...

set -euo pipefail

usage() {
  cat <<EOF
jint installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/main/install.sh | bash
  curl -fsSL .../install.sh | VERSION=v1.2.3 bash    # pin to a release (env on the bash side of the pipe)

Environment:
  VERSION    release tag to install (default: latest)
EOF
}

# curl or wget - slim containers sometimes ship only wget
download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$1" -O "$2"
  else
    echo "jint install: needs curl or wget" >&2
    return 1
  fi
}


# install_skills: copy the generated agent skills (skills/jint-follow,
# skills/jint-author) into the platform skill dirs this machine has. The repo
# skills/ dir is the canonical source; per-platform locations are install
# targets only (open Agent Skills spec). Source resolution order:
#   1. a checkout next to this script (skills/ exists there)
#   2. skills/ shipped in the release tarball (future)
# A platform dir receives skills only if its base exists:
#   .claude/skills (cwd or HOME) and ~/.mobius/skills.
install_skills() {
  local src="" cand base dest script_dir
  # Source resolution order: checkout next to this script (skills/ sibling),
  # cwd checkout, skills/ shipped in the release tarball (future).
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || script_dir=""
  for cand in "${script_dir}/skills" "skills" "${tmp}/skills"; do
    if [ -n "$cand" ] && [ -d "${cand}/jint-follow" ] && [ -d "${cand}/jint-author" ]; then
      src="$cand"
      break
    fi
  done
  if [ -z "$src" ]; then
    echo "skills: no skills/ source (checkout or tarball) - skipped"
    return 0
  fi
  # A platform dir receives skills only if its base exists:
  # .claude/skills (script dir, cwd, or HOME) and ~/.mobius/skills.
  for base in "${script_dir}/.claude" "${PWD}/.claude" "${HOME}/.mobius"; do
    [ -n "$base" ] && [ -d "$base" ] || continue
    dest="${base}/skills"
    mkdir -p "$dest"
    cp -R "${src}/jint-follow" "${src}/jint-author" "$dest/"
    echo "skills: copied jint-follow, jint-author -> ${dest}"
  done
}


main() {
  case "${1:-}" in
    -h|--help) usage; return 0 ;;
  esac

  local base="${RELEASE_BASE:-https://github.com/sedulustech/jint/releases}"
  if [ -n "${VERSION:-}" ]; then
    base="${base}/download/${VERSION}"
  else
    base="${base}/latest/download"
  fi

  # tmp is deliberately NOT local: the EXIT trap (below) still needs it after main returns
  local tarball bin_dir
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

  # Apple Silicon under Rosetta: a translated shell reports x86_64; the native
  # arm64 build is the right install for that machine
  if [ "$os" = darwin ] && [ "$arch" = x64 ] \
    && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    arch=arm64
  fi

  # the linux builds link glibc; a musl (alpine) system would download fine and
  # then fail to exec. Strict: every path must yield a verdict - a broken or
  # missing ldd refuses the install rather than assuming glibc.
  if [ "$os" = linux ]; then
    local libc=""
    if [ -f /etc/alpine-release ]; then
      libc=musl
    elif command -v ldd >/dev/null 2>&1; then
      local ldd_out
      ldd_out="$(ldd --version 2>&1)" || true
      case "$ldd_out" in
        *musl*|*MUSL*) libc=musl ;;
        *glibc*|*GLIBC*|*Glibc*|*"GNU libc"*) libc=glibc ;;
      esac
    fi
    if [ "$libc" = musl ]; then
      echo "jint install: musl libc (alpine) is not supported yet - no musl build is published" >&2
      return 1
    elif [ -z "$libc" ]; then
      echo "jint install: cannot determine the libc (ldd missing, failed, or unfamiliar) - refusing to guess; report this at https://github.com/sedulustech/jint/issues" >&2
      return 1
    fi
  fi

  tarball="jint-${os}-${arch}.tar.gz"

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "downloading ${base}/${tarball}"
  download "${base}/${tarball}" "${tmp}/${tarball}"
  download "${base}/checksums.txt" "${tmp}/checksums.txt"

  # sha256sum (GNU) or shasum (macOS); pick the checker BEFORE piping - a failed
  # check consumes stdin, so an || fallback would always see an empty stream.
  # Only the downloaded tarball's line, since checksums.txt covers every platform asset.
  local check
  if command -v sha256sum >/dev/null 2>&1; then check="sha256sum -c -"; else check="shasum -a 256 -c -"; fi
  (
    cd "$tmp"
    grep "  ${tarball}$" checksums.txt | $check
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
  install_skills
}

main "$@"
