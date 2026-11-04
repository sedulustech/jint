---
title: Install jint
description: "jint is in beta. Download the binary, check it against the published checksums, and put it on your PATH."
sidebar:
  label: Install
---

# Install

jint ships as one binary per platform. It carries its own runtime, so you need no JavaScript
runtime to run it or to write `.ts` rules.

jint is in beta. Download it from the [download page](/download/) or the
[GitHub releases](https://github.com/sedulustech/jint/releases). That is the only way to install it
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

On Linux the only system requirement is glibc, which any mainstream distribution has. On
musl-based images such as Alpine, install a glibc layer first or use a glibc base image.

## First run

jint asks a classifier endpoint its questions, so it needs an API key in the environment:
`JINT_API_KEY`, or `OPENAI_API_KEY`. It runs only the rules a config names, so write a
`jint.config.ts` first; running `jint run` without one prints every rule domain and a working
example. See [Configuration](config.md) for the config and [Rules](rules.md) for the rules.

## Uninstall

Delete the binary: `rm ~/.local/bin/jint`.

## Build from source

See [Development](../README.md#development) in the README.
