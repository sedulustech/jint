import { describe, expect, test } from "bun:test";
import { newRunId, runIdStartMs } from "./run-id.ts";

describe("run ids", () => {
  test("a new id is a UUIDv7 that carries its start", () => {
    const start = Date.UTC(2026, 10, 16, 19, 17, 15, 834);
    const id = newRunId(start);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(runIdStartMs(id)).toBe(start);
    expect(newRunId(start)).not.toBe(id);
  });

  test("an id that is not a UUIDv7 carries no start", () => {
    expect(runIdStartMs("1794856633973")).toBeNull();
    expect(runIdStartMs("generated")).toBeNull();
  });

  test("ids sort by start as plain strings", () => {
    const ids = [1794856633974, 1700000000000, 1794856633973].map((ms) => newRunId(ms));
    expect([...ids].sort().reverse()).toEqual([ids[0]!, ids[2]!, ids[1]!]);
  });
});
