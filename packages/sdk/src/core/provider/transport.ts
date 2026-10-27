/**
 * What an adapter that calls its provider with plain fetch shares: the failure taxonomy (a status
 * is one ClassifyError code), and the retry and per-attempt timeout around one POST. The
 * `decisions` adapter's client does its own retrying and uses the status mapping only.
 */

import { ClassifyError } from "../types.ts";
import type { Fetch } from "./protocol.ts";

/** Per attempt. */
export const ATTEMPT_TIMEOUT_MS = 10_000;
export const MAX_RETRIES = 2;

export interface Limits {
  timeoutMs: number;
  maxRetries: number;
}

/** The ClassifyError for an HTTP failure status: auth, a rejected request, else unavailable. */
export function statusError(
  status: number | undefined,
  message: string,
  input: string,
  cause?: unknown,
): ClassifyError {
  if (status === 401 || status === 403) {
    return new ClassifyError("PROVIDER_AUTH", input, `provider rejected the API key: ${message}`, {
      cause,
    });
  }
  if (status === 400 || status === 422) {
    return new ClassifyError(
      "PROVIDER_REQUEST_INVALID",
      input,
      `provider rejected the request: ${message}`,
      { cause },
    );
  }
  return new ClassifyError("PROVIDER_UNAVAILABLE", input, `provider unavailable: ${message}`, {
    cause,
  });
}

/** Whether a failed status is worth another attempt: timeouts, rate limits and server errors. */
const retryable = (status: number): boolean => status === 408 || status === 429 || status >= 500;

/** Seconds a Retry-After header asks to wait, if it says; capped so a hostile value cannot stall. */
function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 60_000) : undefined;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", done);
      resolve();
    }, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

/** The text of an error body: the provider's message when it sends one, else the body. */
function errorText(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    const e = body.error;
    const message = typeof e === "string" ? e : (e?.message ?? body.message);
    if (message !== undefined) return message;
  } catch {
    // not JSON: the text itself is the evidence
  }
  return text.slice(0, 300);
}

/** One attempt: the reply, or the failure and whether another attempt may follow it. */
type Attempt =
  | { ok: true; reply: unknown }
  | { ok: false; failure: ClassifyError; retry: boolean; wait?: number };

/**
 * POSTs `init` to `url` and returns the parsed JSON reply. A retryable failure (429, 5xx, a network
 * error, an attempt timeout) is tried again up to `maxRetries` times, backing off from 500 ms and
 * honoring Retry-After; each retry logs a "provider backoff:" line. Every failure leaves as a
 * ClassifyError: a status by statusError, a timeout as PROVIDER_TIMEOUT, a network error as
 * unavailable, an unparseable reply as response-invalid. An abort by the caller's signal rethrows
 * as is.
 */
export async function postJson(
  call: {
    fetch: Fetch;
    log: (line: string) => void;
    limits: Limits;
    /** What a ClassifyError names as its input. */
    input: string;
    signal?: AbortSignal;
  },
  url: string,
  init: Omit<RequestInit, "signal">,
): Promise<unknown> {
  const { limits, signal } = call;
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(limits.timeoutMs);
    const attemptSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    const done = await tryOnce(call, url, init, attemptSignal, timeout);
    if (done.ok) return done.reply;
    const left = limits.maxRetries - attempt;
    if (!done.retry || left <= 0 || signal?.aborted) throw done.failure;
    const pause = done.wait ?? Math.min(500 * 2 ** attempt, 8_000) * (0.75 + Math.random() * 0.25);
    call.log(
      `provider backoff: ${done.failure.message} - retrying in ${Math.round(pause)}ms, ${left} ${left === 1 ? "attempt" : "attempts"} remaining`,
    );
    await sleep(pause, signal);
    if (signal?.aborted) throw done.failure;
  }
}

async function tryOnce(
  call: { fetch: Fetch; limits: Limits; input: string; signal?: AbortSignal },
  url: string,
  init: Omit<RequestInit, "signal">,
  signal: AbortSignal,
  timeout: AbortSignal,
): Promise<Attempt> {
  const { input } = call;
  try {
    const response = await call.fetch(url, { ...init, signal });
    if (!response.ok) {
      return {
        ok: false,
        failure: statusError(response.status, errorText(await response.text()), input),
        retry: retryable(response.status),
        wait: retryAfterMs(response),
      };
    }
    try {
      return { ok: true, reply: await response.json() };
    } catch (e) {
      if (signal.aborted) throw e;
      const failure = new ClassifyError(
        "PROVIDER_RESPONSE_INVALID",
        input,
        "provider reply is not JSON",
        { cause: e },
      );
      return { ok: false, failure, retry: false };
    }
  } catch (e) {
    if (call.signal?.aborted) throw e;
    if (timeout.aborted) {
      const failure = new ClassifyError(
        "PROVIDER_TIMEOUT",
        input,
        `provider did not answer within ${call.limits.timeoutMs} ms`,
        { cause: e },
      );
      return { ok: false, failure, retry: true };
    }
    const detail = e instanceof Error ? e.message : String(e);
    const failure = new ClassifyError(
      "PROVIDER_UNAVAILABLE",
      input,
      `provider unreachable: ${detail}`,
      {
        cause: e,
      },
    );
    return { ok: false, failure, retry: true };
  }
}
