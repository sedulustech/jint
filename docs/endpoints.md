---
title: Models and endpoints
description: "Which model answers jint's questions, and what to set to use OpenAI, a local model, or another server."
sidebar:
  label: Endpoints
---

# Models and endpoints

jint sends its questions to one endpoint. The default is OpenAI's Decisions API with the model
`gpt-6-luna`. To use anything else, set the endpoint's url. jint reads the wire from the end of the
url. You do not choose a client or a provider.

## The default

```sh
export OPENAI_API_KEY=...
jint run src
```

jint asks `https://api.openai.com/v1/decisions`. A run with no url set always goes there.

OpenAI's Decisions API is the default because it is deterministic: the same input gives the same
reading. A threshold needs that, because a reading that moves between runs puts a file on both
sides of it.

## Another endpoint

Set `JINT_API_URL`. Its last segment names the wire:

| The url ends in | The server speaks        | Servers                                |
| --------------- | ------------------------ | -------------------------------------- |
| `/decisions`    | the OpenAI Decisions API | OpenAI, or a proxy you run             |
| `/v1/systemone` | the System One API       | TypeSafe, Liquid, OpenRouter, Lemonade |

jint treats a url that ends in neither as `/decisions`. The run then fails at setup and names the
url it expected.

A prefix before `/v1/systemone` is fine. The url names the wire by its end, not by its host.

## Other System One servers

Any server that serves `/v1/systemone` works the same way. Set the url, the key and the model:

```sh
# Liquid
export JINT_API_URL=https://api.liquid.ai/decisions/v1/systemone
export JINT_API_KEY=...
export JINT_API_MODEL=d1

# OpenRouter
export JINT_API_URL=https://openrouter.ai/api/v1/systemone
export JINT_API_KEY=...
export JINT_API_MODEL=typesafe/jev-1.13
```

A host other than TypeSafe's needs `JINT_API_MODEL`. A server that wraps its reply, or serves the
wire at a path that does not end in `/v1/systemone`, is not supported.

## A local model

[Lemonade](https://github.com/lemonade-sdk/lemonade) serves decision models on your machine, at a
`/v1/systemone` endpoint. See [run a local model](local.md) for the settings and a complete example.

## The settings

See the [environment variables](config.md#environment-variables) for each setting and its default.

## Rules jint enforces

- **A key goes only to its own url.** jint never sends `OPENAI_API_KEY` to another host. A custom
  url with only `OPENAI_API_KEY` set fails at setup. The error says to set `JINT_API_KEY`.
- **Only your own machine may go without a key.** A `/v1/systemone` url on `localhost`,
  `127.0.0.1` or `::1` needs no key. Any other host needs one.
- **A `/v1/systemone` server needs a model name.** One server can serve many models. The run
  fails at setup until you set `JINT_API_MODEL`. TypeSafe's own host has a default.

## Change the model, then recalibrate

Each rule's thresholds are calibrated against one model. A different model gives different numbers
for the same question. After you change `JINT_API_MODEL` or the url, calibrate each rule again
(see [calibration](calibration.md)). Do not trust its findings before that.

A run records the model that answered. The run view shows it.

## Known limits

- The answer cache applies to `/decisions` runs. A `/v1/systemone` run asks every question again.
