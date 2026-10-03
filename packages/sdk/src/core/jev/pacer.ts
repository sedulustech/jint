/**
 * The run knobs at the classifier seam: pacer (compliance), limit (wall-clock), timeout (liveness).
 *
 * Two rate knobs, different jobs (design: tmp/designs/rules-context/03-execution-model.md, "##
 * Concurrency"; probe numbers cited inline below - the probe file lives in the untracked tmp/ of
 * the main checkout, so the numbers, not the path, are the record):
 *
 * - Concurrency bounds IN-FLIGHT calls run-wide (the wall-clock knob; measured: 53.9 rps at 16 with
 *   realistic payloads, zero 429s, median 283ms / p95 380ms latency).
 * - Rps_budget bounds ARRIVALS - the enqueue side, not strictly request starts (the compliance knob;
 *   published quota 1,200 rpm = 20 rps, currently unenforced). The pacer sits OUTSIDE the limit, so
 *   a paced caller never holds a slot; the cost is that semaphore-queued work drains the bucket
 *   without starting, so under saturation the start rate dips below the budget. That errs slow
 *   (safe) by composition; see the timeout for the other failure direction.
 * - Timeout bounds a single call's duration: a hung request converts to a per-element JEV_TIMEOUT
 *   failure instead of holding a run-wide slot forever (default 30s - generous against the measured
 *   p95 of 380ms; the SDK's own retries have their own budget and this is NOT a retry layer).
 *
 * The pacer is the ONLY rate layer: the typesafe SDK already retries with backoff and honors
 * Retry-After. Composition order is load-bearing: withLimit(withPacer(withTimeout(raw))) - the
 * caller acquires the limit slot only after its pace token, and the timeout fires while holding a
 * slot so a hang frees the slot instead of pinning it.
 */

import { ClassifyError, type Classifier } from "../types.ts";

export interface Pacer {
  /** Resolves when one request may start. */
  acquire(): Promise<void>;
}

/** The measured/default knob values (probe evidence, not guesses). */
export const DEFAULT_CONCURRENCY = 16;
/** Hard cap: beyond this the pool adds latency, not throughput (probe: p95 380ms at 16). */
export const MAX_CONCURRENCY = 64;
/** ~75% of the published 20 rps quota: headroom for other consumers of the same key. */
export const DEFAULT_RPS_BUDGET = 15;
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
  if (
    knobs.rps_budget !== undefined &&
    (!(knobs.rps_budget > 0) || !Number.isFinite(knobs.rps_budget))
  ) {
    return `rps_budget: must be a number > 0, got ${knobs.rps_budget}`;
  }
  if (knobs.timeout !== undefined && (!(knobs.timeout > 0) || !Number.isFinite(knobs.timeout))) {
    return `timeout: must be a number > 0 (seconds), got ${knobs.timeout}`;
  }
  return null;
}

/**
 * The token bucket. Acquisition is serialized (one in-flight waiter mutates the bucket), time is
 * injectable for tests. `now` in milliseconds.
 */
export function createRpsPacer(
  rps: number,
  burst: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => number = Date.now,
): Pacer {
  let tokens = burst;
  let last = now();
  let chain: Promise<void> = Promise.resolve();
  const acquire = async (): Promise<void> => {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) * rps) / 1000);
    last = t;
    if (tokens >= 1) {
      tokens -= 1;
      return;
    }
    const waitMs = ((1 - tokens) * 1000) / rps;
    const entered = now();
    tokens = 0;
    await sleep(waitMs);
    last = now();
    // Credit refill accrued while sleeping (setTimeout may overshoot waitMs): without this the
    // sustained rate drifts below the budget by the overshoot. Capped by Math.min on the next
    // acquire, so credit never hoards.
    const overslept = now() - entered - waitMs;
    if (overslept > 0) tokens = Math.min(burst, (overslept * rps) / 1000);
  };
  return {
    acquire: () => {
      const run = chain.then(acquire, acquire);
      // keep the chain alive regardless of rejection (acquire never rejects, but be safe)
      chain = run.catch(() => {});
      return run;
    },
  };
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

/** Wraps a classifier so every request start is paced. Identity when pacer is absent. */
export function withPacer(classifier: Classifier, pacer: Pacer | undefined): Classifier {
  if (pacer === undefined) return classifier;
  return async (state, questions) => {
    await pacer.acquire();
    return classifier(state, questions);
  };
}

/**
 * Bounds one classifier call's duration: a hung request rejects as JEV_TIMEOUT after `seconds`
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
                "JEV_TIMEOUT",
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
