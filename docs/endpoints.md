---
title: Models and endpoints
description: "Which model answers jint's questions, and what to set to use OpenAI, a local model, or another server."
sidebar:
  label: Endpoints
---

# Models and endpoints

jint sends its questions to one endpoint. The default is OpenAI's Decisions API with the model
`gpt-6-luna`. To use anything else, set the endpoint's url. jint reads the wire from the end of the
url, so you do not choose a client or a provider.

## The default

```sh
export OPENAI_API_KEY=...
jint run src
```

jint asks `https://api.openai.com/v1/decisions`. With no url set, this is where every run goes.

## Another endpoint

Set `JINT_API_URL`. Its last segment names the wire:

| The url ends in | The server speaks        | Servers                    |
| --------------- | ------------------------ | -------------------------- |
| `/decisions`    | the OpenAI Decisions API | OpenAI, or a proxy you run |
| `/v1/systemone` | the System One API       | TypeSafe, Lemonade         |

A url that ends in neither is treated as `/decisions`, and the run fails at setup with the url it
expected.

## A local model with Lemonade

[Lemonade](https://github.com/lemonade-sdk/lemonade) serves decision models on your machine. Its
`/v1/systemone` endpoint takes the same three question types as jint: `noul`, `score` and
`choice`. Lemonade labels this endpoint experimental.

1. Install Lemonade and pull a decision model, for example `d3-lite-FLM` (FastFlowLM, on the NPU)
   or `Laya-GGUF` (llama.cpp).
2. Point jint at it and name the model:

```sh
export JINT_API_URL=http://localhost:13305/v1/systemone
export JINT_API_MODEL=d3-lite-FLM
jint run src
```

A Lemonade server on this machine has no key unless its owner set one, so jint sends none. If
Lemonade runs with `LEMONADE_API_KEY`, give jint the same key:

```sh
export JINT_API_KEY=<the value of LEMONADE_API_KEY>
```

## The settings

| Variable         | What it does                                                          |
| ---------------- | --------------------------------------------------------------------- |
| `OPENAI_API_KEY` | The key for `api.openai.com`. It goes nowhere else.                   |
| `JINT_API_URL`   | The endpoint. Unset means OpenAI's Decisions API.                     |
| `JINT_API_KEY`   | The key for the url in `JINT_API_URL`. It wins over `OPENAI_API_KEY`. |
| `JINT_API_MODEL` | The model to ask. Unset means `gpt-6-luna` on `/decisions`.           |

A config file holds none of these, because a config is committed.

## Rules jint enforces

- **A key goes only to its own url.** `OPENAI_API_KEY` is never sent to another host. A custom url
  with only `OPENAI_API_KEY` set fails at setup and says to set `JINT_API_KEY`.
- **Only your own machine may go without a key.** A `/v1/systemone` url on `localhost`,
  `127.0.0.1` or `::1` needs no key. Any other host needs one.
- **A `/v1/systemone` server must be told the model.** One server can serve many models, so the
  run fails at setup until `JINT_API_MODEL` is set. TypeSafe's own host has a default and needs
  none.

## Change the model, then recalibrate

A rule's thresholds are calibrated against the model that answered. A different model answers the
same question with different numbers. After you change `JINT_API_MODEL` or the url, test each rule
again with [calibration](calibration.md) before you trust its findings.

A run records the model that answered, and the run view shows it.

## Known limits

- The answer cache applies to `/decisions` runs. A `/v1/systemone` run asks
  every question again.
