# Answer cache

jint stores each answer it gets and serves it again when the same question is asked about the same
code. A rerun of unchanged code sends nothing, costs nothing, and reads the same.

The endpoint has a cache of its own (an input of 1,024 tokens or more is kept for about 30
minutes). That one saves tokens on a request that still goes out. This one removes the request.

## The key

One entry per question. The key is the SHA-256 of

```
<endpoint: scheme, host and path> "\n" <the request body this question would be sent alone>
```

The body is exactly what jint posts: `model`, then `input` (the state as one `input_json` part:
`path` and the element's `source`, or the file's `content`), then `questions` holding this one
question, named `q0`.

| Moves the key                                                 | Does not move the key                      |
| ------------------------------------------------------------- | ------------------------------------------ |
| the question's wording, criteria or levels                    | the API key                                |
| the code the question is about                                | where the question sits among its siblings |
| the file path (the model reads it)                            | the question's name (the rule's name)      |
| the model id                                                  | a line number: jint sends none             |
| the endpoint: scheme, host and path (never userinfo or query) | the run, the time, the element's run id    |
| any change to how jint builds the request                     | a reorder of the rules in the config       |

Because the key is the hash of the request itself, there is no version number to maintain. A change
to the wire format changes every key, and the old entries are never read again.

The endpoint's path is in the key too: one host can route to different backends by path (a gateway,
an API version), and an answer is only the same where the backend is. Userinfo and query stay out,
because they can carry a credential.

The path of the file is in the key on purpose. Rules such as `has_filename_mismatch` judge it, so a renamed file
is a new question.

## Why one key per question, not per request

A request carries every rule that applies to an element. A key per request would re-ask all of an
element's rules when one rule's wording changes. A key per question re-asks only that rule. That is
sound only if a question gets the same answer alone as in a batch.

We measured it (luna, three TypeScript files, 164 element-and-rule pairs, 12 of the 14 default
rules applying). The batched run sent 31 requests of 2 to 8 questions. The isolated runs sent one question per
request. 160 of 160 valued readings were identical to the digit, and the 4 refused pairs were
refused in both. Not one reading moved.

Rerun that comparison before trusting the cache on another endpoint or model. The Decisions API is
free to let questions influence each other, and nothing in jint can detect it.

## What is stored

`<cache dir>/<first two hex digits>/<key>.json`: the answer as the endpoint sent it (without its
positional name), the model id, and the time it was answered. A hit goes through the same reading
as a fresh reply, so confidence and refusals come out the same. An entry that no longer reads is a
miss. A store that cannot be read or written costs the cache, never the run.

Refusals are stored too. Errors are not.

## Where, and how to bypass

The store is `$JINT_CACHE_DIR`, else `~/.jint/cache`. `jint run --no-cache` (SDK: `cache: false`)
asks every question and neither reads nor writes the store.

Nothing expires. The model has no snapshot, so an endpoint-side model update leaves older entries
standing. Each entry carries its time. Delete the directory, or run with `--no-cache`, to start
clean.

## In a run

A hit leaves a request file in the run's directory, marked `cached: true`, with no usage. The run
view reads it like any other request. The end-of-run line counts them:

```
requests -> ~/.jint/runs/1793... (3 calls, 38 answers from the cache)
```

A call that mixes hits and misses records two files: the hits (cached) and the one request that
went out for the misses.
