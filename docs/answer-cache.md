---
title: Answer cache
description: "How jint stores each answer and serves it again for the same question about the same code, and how the endpoint's own cache interacts."
sidebar:
  label: Answer cache
---

# Answer cache

jint stores each answer and serves it again when the same question is asked about the same code. A
rerun of unchanged code sends nothing, costs nothing and reads the same.

The endpoint has its own cache. That one saves tokens on a request that still goes out. This one
removes the request.

## The key

The key is the SHA-256 of the endpoint's scheme, host and path, a newline, and the request body
this question would be sent alone. The body is what jint posts: `model`, `input` (the `path` and
the element's `source`, or the file's `content`) and the one question.

These change the key:

- the question's wording, criteria or levels
- the code the question is about
- the file path, because the model reads it
- the model id
- the endpoint's scheme, host or path
- any change to how jint builds the request

These do not: the API key, the question's place among its siblings, the rule's name, the run, and
the order of rules in the config.

The key hashes the request, so there is no version number to maintain. A change to the wire format
changes every key, and jint never reads the old entries again.

## One key per question

A request carries every rule that applies to an element. A key per question re-asks only the rule
whose wording changed. That is sound only if a question gets the same answer alone as in a batch.

We measured it with `gpt-6-luna` on 164 element-and-rule pairs. All 160 valued classifications matched to
the digit, and the 4 refused pairs were refused in both runs. Repeat the comparison before you
trust the cache on another endpoint or model.

## Storage

Entries live in `$JINT_CACHE_DIR`, else `~/.jint/cache`. Each entry holds the answer as the
endpoint sent it, the model id and the time.

- jint stores refusals. It does not store errors.
- A hit reads like a fresh reply. An entry that no longer reads is a miss.
- A store that fails to read or write costs the cache, never the run.
- Nothing expires. Delete the directory to start clean.

`jint run --no-cache` (SDK: `cache: false`) asks every question and neither reads nor writes the
store.

## In a run

A hit leaves a request file in the run's directory, marked `cached: true`, with no usage. The
end-of-run line counts them:

```
requests -> ~/.jint/runs/1793... (3 calls, 38 answers from the cache)
```
