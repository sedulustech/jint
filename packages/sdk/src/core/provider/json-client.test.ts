import { describe, expect, test } from "bun:test";
import {
  ConnectionError,
  HttpError,
  RequestError,
  parseRetryAfter,
  postJson,
  retryDelayMs,
} from "./json-client.ts";
import type { Fetch } from "./protocol.ts";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** A server that answers with each reply in turn (a function throws), counting the calls. */
function serve(...replies: (Response | (() => Response))[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    const next = replies[Math.min(calls.length, replies.length) - 1]!;
    return typeof next === "function" ? next() : next.clone();
  };
  return { calls, fetch };
}

/** The error a call ends in. */
const failed = (call: Promise<unknown>): Promise<HttpError & ConnectionError> =>
  call.then(
    () => {
      throw new Error("the call succeeded");
    },
    (e) => e as HttpError & ConnectionError,
  );

const post = (fetch: Fetch, extra: Partial<Parameters<typeof postJson>[0]> = {}) =>
  postJson({
    fetch,
    baseUrl: "http://x.test",
    path: "/v1/systemone",
    body: { a: 1 },
    timeoutMs: 1_000,
    maxRetries: 2,
    ...extra,
  });

describe("json client", () => {
  test("posts uncompressed JSON with the bearer key", async () => {
    const api = serve(json({ ok: true }));
    expect(await post(api.fetch, { apiKey: "k" })).toEqual({ ok: true });
    const { url, init } = api.calls[0]!;
    expect(url).toBe("http://x.test/v1/systemone");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer k");
    expect(headers.get("Content-Encoding")).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({ a: 1 });
  });

  test("retry-after-ms is honored, and each wait is logged", async () => {
    const api = serve(json({ error: "slow" }, 429, { "retry-after-ms": "30" }), json({ ok: 1 }));
    const lines: string[] = [];
    const started = Date.now();
    expect(await post(api.fetch, { log: (l) => lines.push(l) })).toEqual({
      ok: 1,
    });
    expect(api.calls).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    // an unhonored header would wait the 500ms backoff
    expect(Date.now() - started).toBeLessThan(400);
    expect(lines).toEqual(["retrying in 30ms (retry 1/2) after 429"]);
  });

  test("retry-after in seconds is honored", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "2" }))).toBe(2000);
    expect(parseRetryAfter(new Headers({ "retry-after-ms": "7", "retry-after": "2" }))).toBe(7);
    expect(parseRetryAfter(new Headers({ "retry-after": "nope" }))).toBeUndefined();
    expect(retryDelayMs(0, new Headers({ "retry-after": "2" }))).toBe(2000);
    // a delay over a minute falls back to the backoff
    expect(retryDelayMs(0, new Headers({ "retry-after": "120" }), () => 0)).toBe(500);
  });

  test("backoff doubles from 500ms, caps at 5s and loses up to a quarter to jitter", () => {
    expect(retryDelayMs(0, undefined, () => 0)).toBe(500);
    expect(retryDelayMs(1, undefined, () => 0)).toBe(1000);
    expect(retryDelayMs(9, undefined, () => 0)).toBe(5000);
    expect(retryDelayMs(1, undefined, () => 1)).toBe(750);
  });

  test("a status that is not retryable is asked once", async () => {
    const api = serve(json({ error: "bad key" }, 401));
    const failure = await failed(post(api.fetch));
    expect(failure).toBeInstanceOf(HttpError);
    expect(failure.status).toBe(401);
    expect(failure.message).toBe("401 bad key");
    expect(api.calls).toHaveLength(1);
  });

  test("retries stop at the limit and the last status is the error", async () => {
    const api = serve(json({ error: "down" }, 503, { "retry-after-ms": "1" }));
    const failure = await failed(post(api.fetch));
    expect(failure).toBeInstanceOf(HttpError);
    expect(failure.status).toBe(503);
    expect(api.calls).toHaveLength(3);
  });

  test("a connection error is retried, then surfaces as one", async () => {
    let n = 0;
    const fetch: Fetch = async () => {
      n++;
      throw new TypeError("refused");
    };
    const failure = await failed(post(fetch, { maxRetries: 1 }));
    expect(failure).toBeInstanceOf(ConnectionError);
    expect(failure.message).toContain("refused");
    expect(n).toBe(2);
  });

  test("an attempt that outlasts the timeout is a connection error", async () => {
    const fetch: Fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const failure = await failed(post(fetch, { timeoutMs: 20, maxRetries: 0 }));
    expect(failure).toBeInstanceOf(ConnectionError);
    expect(failure.message).toContain("timed out after 20ms");
  });

  test("an abort stops the retries, whether mid-attempt or mid-wait", async () => {
    const waiting = serve(json({ error: "slow" }, 503, { "retry-after-ms": "5000" }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const failure = await post(waiting.fetch, {
      signal: controller.signal,
    }).catch((e: HttpError & ConnectionError) => e);
    expect(failure).toBeInstanceOf(RequestError);
    expect(waiting.calls).toHaveLength(1);

    const midway = new AbortController();
    let n = 0;
    const fetch: Fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        n++;
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        setTimeout(() => midway.abort(), 10);
      });
    const second = await failed(post(fetch, { signal: midway.signal }));
    expect(second).toBeInstanceOf(RequestError);
    expect(n).toBe(1);
  });
});
