import { describe, expect, test } from "bun:test";
import type { AnyState, Classifier } from "../types.ts";

const state = { path: "x", content: "", id: "L1" } as AnyState;
import { checkRunKnobs, withLimit, withTimeout } from "./pacer.ts";

describe("checkRunKnobs", () => {
  test("each failure names the exact field", () => {
    expect(checkRunKnobs({ concurrency: 0 })).toMatch(/concurrency:.*>= 1/);
    expect(checkRunKnobs({ concurrency: 1.5 })).toMatch(/concurrency:.*>= 1/);
    expect(checkRunKnobs({ concurrency: 65 })).toMatch(/concurrency:.*<= 64/);
    expect(checkRunKnobs({ concurrency: 16 })).toBeNull();
  });
});

describe("withTimeout", () => {
  test("a hung call rejects JEV_TIMEOUT after the timeout; a fast call passes through", async () => {
    const hung: Classifier = () => new Promise(() => {}); // never settles
    const timed = withTimeout(hung, 0.02);
    await expect(timed({ path: "a.ts", source: "a" } as AnyState, {})).rejects.toMatchObject({
      name: "ClassifyError",
      code: "JEV_TIMEOUT",
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
