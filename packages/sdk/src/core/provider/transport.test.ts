import { describe, expect, test } from "bun:test";
import { ATTEMPT_TIMEOUT_MS, MAX_RETRIES, limitsFor } from "./transport.ts";

describe("limitsFor", () => {
  test("no call timeout keeps the default attempt limit", () => {
    expect(limitsFor()).toEqual({ timeoutMs: ATTEMPT_TIMEOUT_MS, maxRetries: MAX_RETRIES });
  });
  test("the default call timeout of 30 seconds is the default attempt limit", () => {
    expect(limitsFor(30).timeoutMs).toBe(ATTEMPT_TIMEOUT_MS);
  });
  test("a longer call timeout gives each attempt an equal share", () => {
    expect(limitsFor(120).timeoutMs).toBe(40_000);
    expect(limitsFor(10).timeoutMs).toBe(3_334);
  });
});
