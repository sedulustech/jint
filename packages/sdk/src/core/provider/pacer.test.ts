import { describe, expect, test } from "bun:test";
import type { AnyState, Classifier } from "../types.ts";

const state = { path: "x", content: "", id: "L1" } as AnyState;
import { checkRunKnobs, estimateTokens, withLimit, withTimeout, withTokenRate } from "./pacer.ts";
import { resolveProvider } from "./providers.ts";

describe("checkRunKnobs", () => {
  test("each failure names the exact field", () => {
    expect(checkRunKnobs({ concurrency: 0 })).toMatch(/concurrency:.*>= 1/);
    expect(checkRunKnobs({ concurrency: 1.5 })).toMatch(/concurrency:.*>= 1/);
    expect(checkRunKnobs({ concurrency: 65 })).toMatch(/concurrency:.*<= 64/);
    expect(checkRunKnobs({ concurrency: 16 })).toBeNull();
  });
});

describe("withTimeout", () => {
  test("a hung call rejects PROVIDER_TIMEOUT after the timeout; a fast call passes through", async () => {
    const hung: Classifier = () => new Promise(() => {}); // never settles
    const timed = withTimeout(hung, 0.02);
    await expect(timed({ path: "a.ts", source: "a" } as AnyState, {})).rejects.toMatchObject({
      name: "ClassifyError",
      code: "PROVIDER_TIMEOUT",
      input: "a.ts",
    });
    const fast: Classifier = async () => ({ ok: { value: 1 } });
    expect(await withTimeout(fast, 5)({ path: "a.ts", source: "a" } as AnyState, {})).toEqual({
      ok: { value: 1 },
    });
    // identity when no timeout
    expect(withTimeout(fast, undefined)).toBe(fast);
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
      return Object.fromEntries(Object.keys(questions).map((k) => [k, { value: 0.5 }]));
    };
    const limited = withLimit(classifier, 3);
    await Promise.all(Array.from({ length: 12 }, () => limited(state, { q: {} as never })));
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});

describe("withTokenRate", () => {
  /** A clock whose sleep advances it: waits cost no real time. */
  const fakeClock = () => {
    const clock = {
      time: 0,
      slept: [] as number[],
      now: () => clock.time,
      sleep: async (ms: number) => {
        clock.slept.push(ms);
        clock.time += ms;
      },
    };
    return clock;
  };
  const questions = { q: { type: "noul", instructions: "Is it?" } } as never;
  const call = (n: number) => ({ path: "a.ts", content: "x".repeat(n), id: "L1" }) as AnyState;
  const ok: Classifier = async () => ({ q: { value: 1 } });

  test("identity when the provider has no budget", () => {
    expect(withTokenRate(ok, undefined)).toBe(ok);
    expect(
      resolveProvider({ provider: "systemone" }, {}).spec.limits?.tokensPerMinute,
    ).toBeUndefined();
  });

  test("calls under the budget are not delayed", async () => {
    const clock = fakeClock();
    const paced = withTokenRate(ok, 1_000_000, clock);
    for (let i = 0; i < 5; i++) await paced(call(100), questions);
    expect(clock.slept).toEqual([]);
  });

  test("a call over the minute's budget waits for the oldest admission to leave the window", async () => {
    const clock = fakeClock();
    const tokens = estimateTokens(call(400), questions);
    const paced = withTokenRate(ok, tokens * 2, clock); // room for exactly two
    await paced(call(400), questions);
    clock.time = 10_000;
    await paced(call(400), questions);
    await paced(call(400), questions);
    expect(clock.slept).toEqual([50_000]); // until the first leaves, 60s after it was admitted
    expect(clock.time).toBe(60_000);
  });

  test("a call larger than the whole budget runs alone instead of deadlocking", async () => {
    const clock = fakeClock();
    const paced = withTokenRate(ok, 1, clock);
    await paced(call(400), questions);
    expect(clock.slept).toEqual([]);
    await paced(call(400), questions);
    expect(clock.slept).toEqual([60_000]);
  });

  test("the budget is the selected provider's: table default, config override", () => {
    expect(resolveProvider({}, {}).spec.limits?.tokensPerMinute).toBe(10_000_000);
    const override = { providers: { openai: { limits: { tokensPerMinute: 123 } } } };
    expect(resolveProvider(override, {}).spec.limits?.tokensPerMinute).toBe(123);
  });
});
