#!/usr/bin/env bash
# Install the jint beta binary.
#
#   curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/feat/decisions-model/install.sh | bash
#
# jint is in beta, and the beta channel is the only one: the script downloads the build the
# download page serves (https://jint.sh/dl/download/beta/), verifies its sha256 against
# checksums.txt, and installs the binary into ~/.local/bin. The script carries no version.
#
# RELEASE_BASE is the test hook (defaults to https://jint.sh/dl): point it at a local file:// or
# http directory that holds download/beta/ to stand in for the site.

set -euo pipefail

usage() {
  cat <<EOF
jint installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/feat/decisions-model/install.sh | bash

Installs the jint beta build from https://jint.sh/dl/download/beta/ into ~/.local/bin.
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

main() {
  case "${1:-}" in
    -h|--help) usage; return 0 ;;
  esac

  local base="${RELEASE_BASE:-https://jint.sh/dl}/download/beta"

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
}

main "$@"
