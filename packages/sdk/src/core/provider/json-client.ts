/**
 * A small JSON-over-HTTP client for the System One protocol: one POST, retried the way the vendor's
 * own client retried it. It is endpoint-agnostic (a base url and a path), so another server that
 * takes the same kind of call can reuse it. It speaks through the injected fetch, which is where
 * the recorder sits, and sends the body uncompressed so a recording stays readable.
 *
 * Failures leave as one of three classes: an HttpError (the server answered with a status), a
 * ConnectionError (no answer in time, or no answer at all) or a RequestError (the call never went
 * out, or the caller cancelled it).
 */

import type { Fetch } from "./protocol.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly headers: Headers,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class ConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConnectionError";
  }
}

export class RequestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RequestError";
  }
}

const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MAX_MS = 5_000;
const BACKOFF_JITTER = 0.25;
const MAX_RETRY_AFTER_MS = 60_000;

export const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || (status >= 500 && status < 600);

export function parseRetryAfter(headers: Headers, now = Date.now()): number | undefined {
  const ms = Number(headers.get("retry-after-ms"));
  if (headers.has("retry-after-ms") && Number.isFinite(ms) && ms >= 0) return ms;
  const raw = headers.get("retry-after");
  if (raw === null) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

export function retryDelayMs(
  attempt: number,
  headers?: Headers,
  random: () => number = Math.random,
): number {
  if (headers !== undefined) {
    const told = parseRetryAfter(headers);
    if (told !== undefined && told <= MAX_RETRY_AFTER_MS) return told;
  }
  const exponential = Math.min(BACKOFF_INITIAL_MS * 2 ** attempt, BACKOFF_MAX_MS);
  return Math.round(exponential * (1 - random() * BACKOFF_JITTER));
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function validationErrors(errors: unknown[]): string | undefined {
  const parts = errors.flatMap((e) => {
    if (!isRecord(e) || typeof e.msg !== "string") return [];
    const loc = Array.isArray(e.loc) ? e.loc.filter((x) => x !== "body").join(".") : "";
    return [loc ? `${loc}: ${e.msg}` : e.msg];
  });
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function messageOf(body: unknown): string | undefined {
  if (typeof body === "string") return body || undefined;
  if (!isRecord(body)) return undefined;
  const { error, message, detail } = body;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  if (typeof message === "string") return message;
  if (typeof detail === "string") return detail;
  if (isRecord(detail) && typeof detail.message === "string") return detail.message;
  if (Array.isArray(detail)) return validationErrors(detail);
  return undefined;
}

const MAX_RAW_BODY_IN_MESSAGE = 200;

function describeStatus(status: number, body: unknown): string {
  const detail = messageOf(body);
  if (detail) return `${status} ${detail}`;
  if (body === undefined) return `${status} status code (no body)`;
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return `${status} ${raw.length > MAX_RAW_BODY_IN_MESSAGE ? `${raw.slice(0, MAX_RAW_BODY_IN_MESSAGE)}…` : raw}`;
}

function parseBody(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const cancelled = (cause: unknown) => new RequestError("request aborted by the caller", { cause });

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled(signal.reason));
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled(signal?.reason));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface PostOptions {
  fetch: Fetch;
  /** The server's root, without a trailing slash. */
  baseUrl: string;
  /** The route under it, with its leading slash. */
  path: string;
  /** Sent as a bearer token when set, or in `keyHeader` when that is named. */
  apiKey?: string;
  /** The header that carries the key as it is, for a server that takes no bearer token. */
  keyHeader?: string;
  body: unknown;
  signal?: AbortSignal;
  /** The most one attempt may take, answer body included. */
  timeoutMs: number;
  /** Retries after the first attempt. */
  maxRetries: number;
  /** Receives one line before each wait ("retrying in 200ms (retry 1/2) after 503"). */
  log?: (line: string) => void;
}

/** A number JSON cannot hold is sent as its name, as the vendor's client did. */
const encode = (body: unknown): string =>
  JSON.stringify(body, (_key, value) =>
    typeof value === "number" && !Number.isFinite(value) ? String(value) : value,
  );

const requestInit = (options: PostOptions): RequestInit => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (options.apiKey !== undefined && options.keyHeader !== undefined)
    headers[options.keyHeader] = options.apiKey;
  else if (options.apiKey !== undefined) headers.Authorization = `Bearer ${options.apiKey}`;
  return { method: "POST", headers, body: encode(options.body) };
};

function forwardAbort(from: AbortSignal | undefined, to: AbortController): () => void {
  const abortTo = () => to.abort(from?.reason);
  if (from?.aborted) abortTo();
  from?.addEventListener("abort", abortTo, { once: true });
  return () => from?.removeEventListener("abort", abortTo);
}

function abortAfter(ms: number, controller: AbortController) {
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    controller.abort();
  }, ms);
  return { fired: () => fired, cancel: () => clearTimeout(timer) };
}

function deadline(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const unforward = forwardAbort(signal, controller);
  const timeout = abortAfter(timeoutMs, controller);
  return {
    signal: controller.signal,
    timedOut: timeout.fired,
    dispose: () => {
      timeout.cancel();
      unforward();
    },
  };
}

type Attempted =
  | { response: Response; text: string; failure?: undefined }
  | { failure: RequestError | ConnectionError };

async function attempt(options: PostOptions, url: string, init: RequestInit): Promise<Attempted> {
  const limit = deadline(options.signal, options.timeoutMs);
  try {
    const response = await options.fetch(url, { ...init, signal: limit.signal });
    return { response, text: await response.text() };
  } catch (cause) {
    if (options.signal?.aborted) return { failure: cancelled(cause) };
    if (limit.timedOut()) {
      return {
        failure: new ConnectionError(`Request timed out after ${options.timeoutMs}ms.`, { cause }),
      };
    }
    const detail =
      cause instanceof Error ? `Connection error: ${cause.message}` : "Connection error.";
    return { failure: new ConnectionError(detail, { cause }) };
  } finally {
    limit.dispose();
  }
}

async function backOff(
  options: PostOptions,
  n: number,
  left: number,
  reason: string,
  answered?: Headers,
) {
  const delay = retryDelayMs(n, answered);
  options.log?.(`retrying in ${delay}ms (retry ${n + 1}/${n + left}) after ${reason}`);
  await sleep(delay, options.signal);
}

function statusFailure({ response, text }: { response: Response; text: string }): HttpError {
  const body = parseBody(text);
  return new HttpError(
    response.status,
    body,
    response.headers,
    describeStatus(response.status, body),
  );
}

export async function postJson(options: PostOptions): Promise<unknown> {
  const url = `${options.baseUrl}${options.path}`;
  const init = requestInit(options);
  for (let n = 0; ; n++) {
    const left = options.maxRetries - n;
    const got = await attempt(options, url, init);
    if (got.failure !== undefined) {
      if (got.failure instanceof RequestError || left <= 0) throw got.failure;
      await backOff(options, n, left, got.failure.message);
      continue;
    }
    if (got.response.ok) return parseBody(got.text);
    const error = statusFailure(got);
    if (left <= 0 || !isRetryableStatus(got.response.status)) throw error;
    await backOff(options, n, left, `${got.response.status}`, got.response.headers);
  }
}
