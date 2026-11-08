---
title: Run a local model
description: "Ask a decision model on your own machine: what a local server must provide, the settings jint needs, and a tested example."
sidebar:
  label: Local
---

# Run a local model

A decision model on your machine sends no code to a remote service and costs nothing per
classification. Any local server can answer jint's questions if it speaks one of the two wires. See
[models and endpoints](endpoints.md).

## What the server must provide

- An endpoint that ends in `/decisions` or in `/v1/systemone`.
- The question types your rules use: `noul`, `score` and `choice`.
- Probabilities in each answer. A rule reads the probability, not generated text.

## Point jint at the server

```sh
export JINT_API_URL=http://127.0.0.1:<port>/v1/systemone
export JINT_API_MODEL=<model name>
```

Set no key. A server on your own machine needs none, and jint sends no OpenAI key there. If the
server needs a key, set `JINT_API_KEY`.

## Set concurrency and timeout

A local server often answers one request at a time. Jint sends 16 calls at once by default. The
calls queue, and the last ones time out.

Set the two run settings in `jint.config.json`:

```json
{
  "concurrency": 1,
  "timeout": 120
}
```

- `concurrency` of 1 sends one call at a time.
- `timeout` of 120 gives each attempt 40 seconds. A slow server needs more than the default
  10 seconds for a large input.

See [configuration](config.md#concurrency-and-timeout).

## Know the input limit

A decision model accepts a fixed number of input tokens. The server rejects a larger input. Jint
reports an error for that classification.

Set `maxInputTokens` in `jint.config.json` to the model limit, and `charsPerToken` to the
model's measured ratio. Jint then skips each call that does not fit, and names it in a note. See
[configuration](config.md#input-window).

## Example: Lemonade in a container

[Lemonade](https://github.com/lemonade-sdk/lemonade) serves decision models on your machine. Its
`/v1/systemone` endpoint takes the same question types as jint.

This example is a CPU setup that needs no GPU. We tested it with the `edge` image of Lemonade
(the tip of `main`) and the `Laya-GGUF` model. Lemonade labels this endpoint experimental.

### What you need

- Docker.
- 1 GB of disk for the image and 0.5 GB for the model.
- A CPU. The setup below needs no GPU and no NPU.

### Start Lemonade

1. Pull the image. It is about 760 MB.

   ```sh
   docker pull ghcr.io/lemonade-sdk/lemonade-server:edge
   ```

2. Create four volumes. The container runs as user 10001. Set that user as the owner. Put the
   CPU backend in the configuration volume.

   ```sh
   for v in cache llama data config; do docker volume create lemonade-$v; done
   docker run --rm -v lemonade-config:/c alpine:3.20 sh -c \
     'echo "{\"llamacpp\": {\"backend\": \"cpu\"}}" > /c/config.json && chown -R 10001:10001 /c'
   for v in cache llama data; do
     docker run --rm -v lemonade-$v:/v alpine:3.20 chown -R 10001:10001 /v
   done
   ```

3. Start the container. Publish the port on the loopback address only. Lemonade has no
   authentication unless you set `LEMONADE_API_KEY`.

   ```sh
   docker run -d --name lemonade-server -p 127.0.0.1:13305:13305 \
     -v lemonade-cache:/opt/lemonade/.cache/huggingface \
     -v lemonade-llama:/opt/lemonade/llama \
     -v lemonade-data:/opt/lemonade/.cache/lemonade \
     -v lemonade-config:/opt/lemonade/.config/lemonade \
     ghcr.io/lemonade-sdk/lemonade-server:edge
   ```

4. Pull the model. `Laya-GGUF` is 0.45 GB. `Julia-1-GGUF` is a smaller option at 0.17 GB.

   ```sh
   curl http://127.0.0.1:13305/v1/pull -H "Content-Type: application/json" \
     -d '{"model_name":"Laya-GGUF","stream":false}'
   ```

Lemonade loads the model on the first request. That request takes about 4 seconds longer than
the next ones.

### Point jint at Lemonade

```sh
export JINT_API_URL=http://127.0.0.1:13305/v1/systemone
export JINT_API_MODEL=Laya-GGUF
```

If you start Lemonade with `LEMONADE_API_KEY`, set `JINT_API_KEY` to the same value. The Lemonade
container answers one request at a time, so set `concurrency` of 1 and `timeout` of 120.

### Speed

We measured these values on an Intel Core Ultra 7 165H with the CPU backend.

| Measure                                                 | Value                       |
| ------------------------------------------------------- | --------------------------- |
| First request, model load included                      | 4.2 seconds                 |
| One request with 3 questions and 136 input tokens       | 0.58 seconds                |
| Input speed                                             | about 230 tokens per second |
| A run of 3 rules on one 8.8 KB file, 17 classifications | 40 seconds                  |

The cost of a call grows with the number of input tokens. A short function takes about 1 second.
A whole file of a few thousand tokens takes about 10 seconds.

### Limits

- **Quality.** We checked that the setup works. We did not measure how well Laya separates healthy
  code from defective code. Calibrate each rule before you trust its findings. See
  [calibration](calibration.md).
- **Cache.** The answer cache does not apply to `/v1/systemone` runs. Each run asks every
  question again.
- **Input size.** The `Laya-GGUF` model accepts at most 4096 input tokens. Lemonade answers a
  larger input with `400 context_length_exceeded`. Set `maxInputTokens` to `4096` and
  `charsPerToken` to `2` so jint skips such elements and names them in a note.

### Stop and remove Lemonade

```sh
docker rm -f lemonade-server
docker volume rm lemonade-cache lemonade-llama lemonade-data lemonade-config
```
