---
title: Environment variables
description: "Every environment variable jint reads, generated from the source."
sidebar:
  label: Environment
---

# Environment variables

Every environment variable jint reads, generated from the source.

<!-- generated:reference — do not edit. Regenerate with `bun run schema`. -->

## Variables

### `OPENAI_API_KEY`

The key for `api.openai.com`. jint sends it nowhere else.

### `JINT_API_URL`

The endpoint. Its last segment names the wire. See [models and endpoints](../endpoints.md).

_default OpenAI's Decisions API_

### `JINT_API_KEY`

The key for the url in `JINT_API_URL`. It wins over `OPENAI_API_KEY`.

### `JINT_API_MODEL`

The model to ask. A `/v1/systemone` server needs it, except TypeSafe's own host.

_default `gpt-6-luna` on `/decisions`_

### `JINT_RUNS_DIR`

The directory where jint records runs.

_default `~/.jint/runs`_

### `JINT_CACHE_DIR`

The directory of the answer cache.

_default `~/.jint/cache`_

### `JINT_GRAMMAR_DIR`

The directory of custom grammars.

_default `~/.jint/grammars`_

### `JINT_UI_HOST`

The host that `jint serve` binds. Give a host, not `host:port`.

_default `127.0.0.1`_

### `JINT_UI_PORT`

The port that `jint serve` binds.

_default a free port_

### `JINT_LOG_LEVEL`

The log level on stderr: `debug`, `info`, `warn`, `error` or `off`.

_default `off`_

<!-- /generated:reference -->
