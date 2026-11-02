---
title: Install jint
description: "Install the jint binary with the install script, npm or a direct download, and check it against the published checksums."
sidebar:
  label: Install
  order: 1
---

# Install

jint ships as one binary per platform. It carries its own runtime, so you need no JavaScript
runtime to run it or to write `.ts` rules.

## Install script

```sh
curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/feat/decisions-model/install.sh | bash
```

The script picks the binary for your platform, checks its sha256 against `checksums.txt`, and
installs it to `~/.local/bin/jint`. If that directory is not on your `PATH`, the script says so.

To install a specific release, set `VERSION` on the `bash` side of the pipe:

```sh
curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/feat/decisions-model/install.sh | VERSION=v1.2.3 bash
```

## npm

```sh
npm install -g @sedulus/jint@rc   # or add it as a devDependency
npx @sedulus/jint@rc --version
```

## Download a binary

Each release carries one archive per platform and a `checksums.txt` that covers all of them:

| Platform            | Archive                    |
| ------------------- | -------------------------- |
| Linux x64           | `jint-linux-x64.tar.gz`    |
| Linux arm64         | `jint-linux-arm64.tar.gz`  |
| macOS Apple silicon | `jint-darwin-arm64.tar.gz` |
| macOS Intel         | `jint-darwin-x64.tar.gz`   |

Download the archive for your platform from the site's download page or from the
[GitHub releases](https://github.com/sedulustech/jint/releases). Check it, unpack it, and put the
`jint` binary on your `PATH`:

```sh
sha256sum -c --ignore-missing checksums.txt   # on macOS: shasum -a 256 -c --ignore-missing checksums.txt
tar -xzf jint-linux-x64.tar.gz
install -m 755 jint ~/.local/bin/jint
```

jint.sh mirrors the releases under `/dl/`, in the same layout GitHub uses
(`/dl/latest/download/<archive>` and `/dl/download/<tag>/<archive>`). To make the install script
read from the mirror, set `RELEASE_BASE=https://jint.sh/dl`.

## Beta

The beta channel is one unversioned build, overwritten on every push to the beta branch. It is
not a GitHub release and has no tag. Install it through the mirror:

```sh
curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/feat/decisions-model/install.sh | RELEASE_BASE=https://jint.sh/dl VERSION=beta bash
```

Or download an archive from `https://jint.sh/dl/download/beta/<archive>`, with its
`checksums.txt` beside it. `https://jint.sh/dl/download/beta/COMMIT` names the commit the beta
was built from. Because the beta is overwritten, pin a tagged release when you need the same
binary twice.

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
