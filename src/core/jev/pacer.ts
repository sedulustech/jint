/**
 * The client-side pacer (the compliance knob): a token-bucket in front of the request pool.
 *
 * Two knobs, different jobs (design rules-context/03 §Concurrency):
 *
 * - Concurrency bounds IN-FLIGHT calls (the wall-clock knob; measured: 53.9 rps at 16 with zero 429s,
 *   tmp/observations/concurrency-probe.md).
 * - Rps_budget bounds REQUEST STARTS (the compliance knob; published quota 1,200 rpm = 20 rps,
 *   currently unenforced). When quota becomes enforced, we slow instead of failing.
 *
 * The bucket holds `burst` tokens (the pool width), refilling at `rps` tokens/second, so short runs
 * never wait and sustained fire is paced to the budget. This is the ONLY rate layer: the typesafe
 * SDK already retries with backoff and honors Retry-After — no second retry layer here.
 */

import type { Classifier } from "../types.ts";

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

/** Validates both knobs; the error names the exact field (CONFIG_INVALID pass). */
export function checkRunKnobs(knobs: {
  readonly concurrency?: number;
  readonly rps_budget?: number;
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
    tokens = 0;
    await sleep(waitMs);
    last = now();
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
