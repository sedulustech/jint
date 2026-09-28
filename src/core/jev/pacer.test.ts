import { describe, expect, test } from "bun:test";
import type { AnyState, Classifier } from "../types.ts";

const state = { path: "x", id: "L1" } as AnyState;
import { checkRunKnobs, createRpsPacer, withLimit, withPacer } from "./pacer.ts";

describe("checkRunKnobs", () => {
  test("each failure names the exact field", () => {
    expect(checkRunKnobs({ concurrency: 0 })).toMatch(/concurrency:.*>= 1/);
    expect(checkRunKnobs({ concurrency: 1.5 })).toMatch(/concurrency:.*>= 1/);
    expect(checkRunKnobs({ concurrency: 65 })).toMatch(/concurrency:.*<= 64/);
    expect(checkRunKnobs({ rps_budget: 0 })).toMatch(/rps_budget:.*> 0/);
    expect(checkRunKnobs({ rps_budget: -3 })).toMatch(/rps_budget:.*> 0/);
    expect(checkRunKnobs({ concurrency: 16, rps_budget: 15 })).toBeNull();
  });
});

describe("createRpsPacer", () => {
  test("burst passes immediately; sustained fire is paced to the budget", async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const pacer = createRpsPacer(20, 3); // 3-token burst, 20 rps refill
    const start = Date.now();
    for (let i = 0; i < 6; i++) await pacer.acquire();
    // first 3 are burst; the next 3 wait ~50ms each
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(120);
    expect(elapsed).toBeLessThan(1000);
    void sleep;
  });
});

describe("withLimit / withPacer", () => {
  test("the limit is the run-wide in-flight ceiling across concurrent callers", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const classifier: Classifier = async (_state, questions) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return Object.fromEntries(Object.keys(questions).map((k) => [k, 0.5]));
    };
    const limited = withLimit(classifier, 3);
    await Promise.all(Array.from({ length: 12 }, () => limited(state, { q: {} as never })));
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  test("withPacer spaces every request start; identity when the pacer is absent", async () => {
    const calls: number[] = [];
    const classifier: Classifier = async () => {
      calls.push(Date.now());
      return {};
    };
    const paced = withPacer(classifier, createRpsPacer(25, 1)); // 1-token bucket at 25 rps = 40ms
    for (let i = 0; i < 3; i++) await paced(state, {});
    expect(calls).toHaveLength(3);
    expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(30);
    expect(calls[2]! - calls[1]!).toBeGreaterThanOrEqual(30);
    // identity: no pacer, no wrapper behavior
    expect(withPacer(classifier, undefined)).toBe(classifier);
    expect(withLimit(classifier, undefined)).toBe(classifier);
  });
});
