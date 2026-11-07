/**
 * What the adapter shares with its callers: the failure taxonomy (a status is one ClassifyError
 * code) and the limits of one call. The client does its own retrying.
 */

import { ClassifyError } from "../types.ts";

export const ATTEMPT_TIMEOUT_MS = 10_000;
export const MAX_RETRIES = 2;

export interface Limits {
  timeoutMs: number;
  maxRetries: number;
}

/**
 * The limits of one attempt for a call that may take `timeoutSeconds` in all. The call is one
 * attempt and its retries, so an attempt gets an equal share: the default call timeout of 30
 * seconds is the 10 second attempt and two retries. A slower endpoint raises the one setting.
 */
export function limitsFor(timeoutSeconds?: number): Limits {
  const timeoutMs =
    timeoutSeconds === undefined
      ? ATTEMPT_TIMEOUT_MS
      : Math.ceil((timeoutSeconds * 1000) / (MAX_RETRIES + 1));
  return { timeoutMs, maxRetries: MAX_RETRIES };
}

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
