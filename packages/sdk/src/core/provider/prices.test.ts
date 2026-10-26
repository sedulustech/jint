import { describe, expect, test } from "bun:test";
import { runCost } from "./prices.ts";

describe("runCost", () => {
  test("cached tokens bill at the cached rate", () => {
    expect(runCost("gpt-6-luna", { input: 1_000_000, cached: 900_000 })).toBeCloseTo(0.019);
  });
  test("a jev release bills every input token at one rate", () => {
    expect(runCost("jev-1.13.0", { input: 2_000_000 })).toBeCloseTo(0.09);
  });
  test("an unpriced or unrecorded model has no cost", () => {
    expect(runCost("d1", { input: 1000 })).toBeUndefined();
    expect(runCost(undefined, { input: 1000 })).toBeUndefined();
  });
});
