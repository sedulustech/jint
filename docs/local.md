---
title: Run a local model
description: "Ask a decision model on your own machine: what a local server must provide, the settings jint needs, and a tested example."
sidebar:
  label: Local
---

# Run a local model

You can run jint with local models by changing the base URL in the configuration file.

## What the server must provide

- An endpoint that ends in `/decisions` or in `/v1/systemone`.
- The question types: `noul`, `score` and `choice`.
- Probabilities in each answer.

## Point jint at the server

```sh
export JINT_API_URL=http://127.0.0.1:<port>/v1/systemone
export JINT_API_MODEL=<model name>
```

If the server needs a key, set `JINT_API_KEY`.

## Set concurrency and timeout

```json
{
  "concurrency": 1,
  "timeout": 120
}
```

- `concurrency` of 1 sends one call at a time.
- `timeout` A slow server needs more than the default 10 seconds for a large input.

See [configuration](config.md#concurrency-and-timeout).

## Know the input limit

Some decision models have a very short context window, like Laya. Exceeding the model's predefined
limits will return an error.

Set `maxInputTokens` in `jint.config.json` to the model limit, and `charsPerToken` to the
model's measured ratio. Jint skips errors, and labels them it in a note. See
[configuration](config.md#input-window).
