---
title: Install jint
description: "jint is in beta. Install it with one command, or download the binary and check it against the published checksums."
sidebar:
  label: Install
---

# Install

jint is in beta. Install the current build with the [install script](../install.sh):

```sh
curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/feat/decisions-model/install.sh | bash
```

The script picks the archive for your platform, checks it against the published checksums and puts
`jint` in `~/.local/bin`. Add that directory to your `PATH` if it is not there.

## Download a binary

Take the archive for your platform and `checksums.txt` from the [download page](/download/). Check the
archive, unpack it, and put the `jint` binary on your `PATH`:

```sh
sha256sum -c --ignore-missing checksums.txt   # on macOS: shasum -a 256 -c --ignore-missing checksums.txt
tar -xzf jint-linux-x64.tar.gz
install -m 755 jint ~/.local/bin/jint
```

## Download counts

The download mirror counts tarball downloads by version, client type and country. It stores no IP
address. [`downloadPoint`](../web/src/lib/dl.ts) defines exactly what is recorded.

## Requirements

jint carries its own runtime, so you need no JavaScript
runtime to run it or to write `.ts` rules.

jint asks a classifier endpoint its questions, so it needs an API key in the environment:
`JINT_API_KEY`, or `OPENAI_API_KEY`.

On Linux the only system requirement is glibc. On musl-based images such as Alpine,
install a glibc layer first or use a glibc base image.
