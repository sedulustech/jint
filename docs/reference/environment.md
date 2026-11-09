---
title: Environment variables
description: "Every environment variable jint reads, generated from the source."
sidebar:
  label: Environment
---

# Environment variables

Every environment variable jint reads, generated from the source.

<!-- generated:reference — do not edit. Regenerate with `bun run schema`. -->

<h3 id="openai-api-key" class="field"><code>OPENAI_API_KEY</code><span class="pills"></span></h3>

The key for `api.openai.com`. jint sends it nowhere else.

<h3 id="jint-api-url" class="field"><code>JINT_API_URL</code><span class="pills"><span class="pill pair"><span>default</span><span>OpenAI's Decisions API</span></span></span></h3>

The endpoint. Its last segment names the wire. See [models and endpoints](../endpoints.md).

<h3 id="jint-api-key" class="field"><code>JINT_API_KEY</code><span class="pills"></span></h3>

The key for the url in `JINT_API_URL`. It wins over `OPENAI_API_KEY`.

<h3 id="jint-api-model" class="field"><code>JINT_API_MODEL</code><span class="pills"><span class="pill pair"><span>default</span><span><code>gpt-6-luna</code> on <code>/decisions</code></span></span></span></h3>

The model to ask. A `/v1/systemone` server needs it, except TypeSafe's own host.

<h3 id="jint-runs-dir" class="field"><code>JINT_RUNS_DIR</code><span class="pills"><span class="pill pair"><span>default</span><span><code>~/.jint/runs</code></span></span></span></h3>

The directory where jint records runs.

<h3 id="jint-cache-dir" class="field"><code>JINT_CACHE_DIR</code><span class="pills"><span class="pill pair"><span>default</span><span><code>~/.jint/cache</code></span></span></span></h3>

The directory of the answer cache.

<h3 id="jint-grammar-dir" class="field"><code>JINT_GRAMMAR_DIR</code><span class="pills"><span class="pill pair"><span>default</span><span><code>~/.jint/grammars</code></span></span></span></h3>

The directory of custom grammars.

<h3 id="jint-ui-host" class="field"><code>JINT_UI_HOST</code><span class="pills"><span class="pill pair"><span>default</span><span><code>127.0.0.1</code></span></span></span></h3>

The host that `jint serve` binds. Give a host, not `host:port`.

<h3 id="jint-ui-port" class="field"><code>JINT_UI_PORT</code><span class="pills"><span class="pill pair"><span>default</span><span>a free port</span></span></span></h3>

The port that `jint serve` binds.

<h3 id="jint-log-level" class="field"><code>JINT_LOG_LEVEL</code><span class="pills"><span class="pill pair"><span>default</span><span><code>off</code></span></span></span></h3>

The log level on stderr: `debug`, `info`, `warn`, `error` or `off`.

<!-- /generated:reference -->
