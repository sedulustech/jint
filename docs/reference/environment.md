---
title: Environment variables
description: "Every environment variable jint reads, generated from the source."
sidebar:
  label: Environment
---

# Environment variables

Every environment variable jint reads, generated from the source.

<!-- generated:reference — do not edit. Regenerate with `bun run schema`. -->

| Variable           | Default                      | Meaning                                                                                     |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`   | none                         | The key for `api.openai.com`. jint sends it nowhere else.                                   |
| `JINT_API_URL`     | OpenAI's Decisions API       | The endpoint. Its last segment names the wire. See [models and endpoints](../endpoints.md). |
| `JINT_API_KEY`     | none                         | The key for the url in `JINT_API_URL`. It wins over `OPENAI_API_KEY`.                       |
| `JINT_API_MODEL`   | `gpt-6-luna` on `/decisions` | The model to ask. A `/v1/systemone` server needs it, except TypeSafe's own host.            |
| `JINT_RUNS_DIR`    | `~/.jint/runs`               | The directory where jint records runs.                                                      |
| `JINT_CACHE_DIR`   | `~/.jint/cache`              | The directory of the answer cache.                                                          |
| `JINT_GRAMMAR_DIR` | `~/.jint/grammars`           | The directory of custom grammars.                                                           |
| `JINT_UI_HOST`     | `127.0.0.1`                  | The host that `jint serve` binds. Give a host, not `host:port`.                             |
| `JINT_UI_PORT`     | a free port                  | The port that `jint serve` binds.                                                           |
| `JINT_LOG_LEVEL`   | `off`                        | The log level on stderr: `debug`, `info`, `warn`, `error` or `off`.                         |

<!-- /generated:reference -->
