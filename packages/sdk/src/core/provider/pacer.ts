/**
 * The run knobs at the classifier seam: limit (wall-clock), timeout (liveness), and the token
 * budget (the provider's tokensPerMinute).
 *
 * - Concurrency bounds IN-FLIGHT calls run-wide (the wall-clock knob; measured: 53.9 rps at 16 with
 *   realistic payloads, zero 429s, median 283ms / p95 380ms latency). Arrivals are not paced: the
 *   vendor SDK retries with backoff and honors Retry-After, so an overshoot is absorbed upstream
 *   (an rps_budget pacer existed and was removed - git history holds it).
 * - Timeout bounds a single call's duration: a hung request converts to a per-element
 *   PROVIDER_TIMEOUT failure instead of holding a run-wide slot forever (default 30s - generous
 *   against the measured p95 of 380ms; the SDK's own retries have their own budget and this is NOT
 *   a retry layer).
 * - The token budget spaces ARRIVALS by the provider's `limits.tokensPerMinute` (providers.ts): a
 *   call waits while the estimated input tokens of the last minute plus its own would exceed the
 *   budget, so a long run stays under a provider's rate limit instead of living on its 429s. A
 *   provider with no budget is not paced.
 *
 * Composition order is load-bearing: withLimit(withTimeout(raw)) - the timeout fires while holding
 * a slot so a hang frees the slot instead of pinning it.
 */

import { ClassifyError, type AnyState, type Classifier, type QuestionSchema } from "../types.ts";

/** The measured/default knob values (probe evidence, not guesses). */
export const DEFAULT_CONCURRENCY = 16;
/** Hard cap: beyond this the pool adds latency, not throughput (probe: p95 380ms at 16). */
export const MAX_CONCURRENCY = 64;
/**
 * Per-call timeout, seconds. Justified from the probe's p95 of 380ms: 30s is ~80x the p95 and
 * covers the SDK's internal retry chain (several attempts plus backoff) without letting one hung
 * request pin a run-wide slot for the rest of a long run.
 */
export const DEFAULT_TIMEOUT = 30;

/** Validates the run knobs; the error names the exact field (CONFIG_INVALID pass). */
export function checkRunKnobs(knobs: {
  readonly concurrency?: number;
  readonly rps_budget?: number;
  readonly timeout?: number;
}): string | null {
  if (knobs.concurrency !== undefined) {
    if (!Number.isInteger(knobs.concurrency) || knobs.concurrency < 1) {
      return `concurrency: must be an integer >= 1, got ${knobs.concurrency}`;
    }
    if (knobs.concurrency > MAX_CONCURRENCY) {
      return `concurrency: must be <= ${MAX_CONCURRENCY} (in-flight calls beyond the measured ceiling add latency, not throughput), got ${knobs.concurrency}`;
    }
  }
  if (knobs.timeout !== undefined && (!(knobs.timeout > 0) || !Number.isFinite(knobs.timeout))) {
    return `timeout: must be a number > 0 (seconds), got ${knobs.timeout}`;
  }
  return null;
}

/**
 * Wraps a classifier with a global in-flight cap (the wall-clock knob). The per-unit pools schedule
 * the fan-out; this semaphore makes concurrency the RUN's in-flight ceiling across units, not just
 * within one file. Identity when limit is absent.
 */
export function withLimit(classifier: Classifier, limit: number | undefined): Classifier {
  if (limit === undefined) return classifier;
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  const release = (): void => {
    const next = waiters.shift();
    if (next !== undefined) next();
    else inFlight -= 1;
  };
  return async (state, questions) => {
    if (inFlight >= limit) {
      await new Promise<void>((resolve) => waiters.push(resolve));
      // a released slot transfers ownership: do not increment past the cap
    } else {
      inFlight += 1;
    }
    try {
      return await classifier(state, questions);
    } finally {
      release();
    }
  };
}

/**
 * Bounds one classifier call's duration: a hung request rejects as PROVIDER_TIMEOUT after `seconds`
 * (converted to a per-element ClassifyError by the call seam) instead of holding a run-wide slot
 * forever. Liveness, not retry - the typesafe SDK owns retries. Sits INSIDE the limit so the
 * timeout firing frees the slot; the underlying request is not cancelled (the SDK/transport owns
 * the socket), only abandoned. Identity when seconds is absent.
 */
export function withTimeout(classifier: Classifier, seconds: number | undefined): Classifier {
  if (seconds === undefined) return classifier;
  const ms = seconds * 1000;
  return (state, questions) =>
    Promise.race([
      classifier(state, questions),
      new Promise<never>((_resolve, reject) => {
        // unref: the timer must not keep the process alive after the run's work is done (a CLI
        // process would otherwise hang for the full timeout after its last response).
        const timer = setTimeout(
          () =>
            reject(
              new ClassifyError(
                "PROVIDER_TIMEOUT",
                state.path,
                `classifier call exceeded the ${seconds}s timeout - hung request abandoned (liveness, not retry)`,
              ),
            ),
          ms,
        );
        (timer as unknown as { unref?: () => void }).unref?.();
      }),
    ]);
}

/** The estimate the budget is spent in: about four characters per token of what the call sends. */
export const estimateTokens = (
  state: AnyState,
  questions: Record<string, QuestionSchema>,
): number => Math.ceil(JSON.stringify([state, questions]).length / 4);

const MINUTE_MS = 60_000;

/** The clock the token budget reads; tests inject a fake one. */
export interface PacerClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const REAL_CLOCK: PacerClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Paces a classifier under a token budget: a call is admitted when the estimated tokens admitted in
 * the last minute plus its own fit `tokensPerMinute`, else it waits for the oldest admission to
 * leave the window. A call larger than the whole budget runs alone, never deadlocked. Wraps OUTSIDE
 * withLimit, so a waiting call holds no in-flight slot. Identity when the budget is absent.
 */
export function withTokenRate(
  classifier: Classifier,
  tokensPerMinute: number | undefined,
  clock: PacerClock = REAL_CLOCK,
): Classifier {
  if (tokensPerMinute === undefined) return classifier;
  const admitted: Array<{ at: number; tokens: number }> = [];
  return async (state, questions) => {
    const tokens = estimateTokens(state, questions);
    for (;;) {
      const now = clock.now();
      while (admitted.length > 0 && admitted[0]!.at <= now - MINUTE_MS) admitted.shift();
      const used = admitted.reduce((sum, a) => sum + a.tokens, 0);
      if (admitted.length === 0 || used + tokens <= tokensPerMinute) {
        admitted.push({ at: now, tokens });
        return classifier(state, questions);
      }
      await clock.sleep(admitted[0]!.at + MINUTE_MS - now);
    }
  };
}
