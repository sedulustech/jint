import { describe, expect, test } from "bun:test";
import { handleSeverity, type HandlerData } from "@jint/contract";
import { compileNoulHandler, compileScoreHandler } from "./handle.ts";

// Drift pin: the contract evaluator (consumed by the measurement UI) and the engine's compiled
// handles must agree on every (value, handle) pair. If one changes semantics alone, CI fails.
const HANDLES: readonly HandlerData[] = [
  { warn: { greater_than: 0.6 }, error: { greater_than: 0.8 } },
  { warn: { less_than: 0.4 }, error: { less_than: 0.2 } },
  { warn: { greater_than: 0.55 } },
  { warn: { less_than: 0.75 }, error: { less_than: 0.6 }, silent_band: [0.5, 0.6] },
  { map: ["pass", "pass", "warn", "error"] },
  { map: ["error", "warn", "pass"] },
];

describe("contract evaluator == engine compiled handles", () => {
  for (const handle of HANDLES) {
    test(JSON.stringify(handle), () => {
      const isScore = "map" in handle;
      const compiled = isScore ? compileScoreHandler(handle) : compileNoulHandler(handle);
      const values = isScore
        ? [0, 0.5, 1, 1.5, 2, 2.5, 3]
        : Array.from({ length: 101 }, (_, i) => i / 100);
      for (const value of values) {
        let expected = null;
        try {
          expected = compiled({ value });
        } catch {
          expected = null; // out-of-scale score: engine fails loud, contract degrades to silent
        }
        expect(handleSeverity(value, handle)).toEqual(expected === null ? null : expected.severity);
      }
    });
  }
});
