---
title: Install jint
description: "jint is in beta. Download the binary, check it against the published checksums, and put it on your PATH."
sidebar:
  label: Install
---

# Install

jint is in beta. Download it from the [download page](/download/). That is the only way to install it
for now.

## Download a binary

Each release carries one archive per platform and a `checksums.txt` that covers all of them:

| Platform            | Archive                    |
| ------------------- | -------------------------- |
| Linux x64           | `jint-linux-x64.tar.gz`    |
| Linux arm64         | `jint-linux-arm64.tar.gz`  |
| macOS Apple silicon | `jint-darwin-arm64.tar.gz` |
| macOS Intel         | `jint-darwin-x64.tar.gz`   |

Check the archive, unpack it, and put the `jint` binary on your `PATH`:

```sh
sha256sum -c --ignore-missing checksums.txt   # on macOS: shasum -a 256 -c --ignore-missing checksums.txt
tar -xzf jint-linux-x64.tar.gz
install -m 755 jint ~/.local/bin/jint
```

## Requirements

jint carries its own runtime, so you need no JavaScript
runtime to run it or to write `.ts` rules.

jint asks a classifier endpoint its questions, so it needs an API key in the environment:
`JINT_API_KEY`, or `OPENAI_API_KEY`.

On Linux the only system requirement is glibc. On musl-based images such as Alpine,
install a glibc layer first or use a glibc base image.
