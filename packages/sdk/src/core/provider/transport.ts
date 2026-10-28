/**
 * What the adapter shares with its callers: the failure taxonomy (a status is one ClassifyError
 * code) and the limits of one call. The client does its own retrying.
 */

import { ClassifyError } from "../types.ts";

/** Per attempt, ms. */
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
