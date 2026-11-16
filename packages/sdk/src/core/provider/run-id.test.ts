import { describe, expect, test } from "bun:test";
import { newRunId, newestRunFirst, runIdStartMs } from "./run-id.ts";

describe("run ids", () => {
  test("a new id is a UUIDv7 that carries its start", () => {
    const start = Date.UTC(2026, 10, 16, 19, 17, 15, 834);
    const id = newRunId(start);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(runIdStartMs(id)).toBe(start);
    expect(newRunId(start)).not.toBe(id);
  });

  test("a run named by its start in Unix milliseconds keeps that start", () => {
    expect(runIdStartMs("1794856633973")).toBe(1794856633973);
    expect(runIdStartMs("1700000000001-seed")).toBe(1700000000001);
    expect(runIdStartMs("seed")).toBeNull();
  });

  test("a store with both kinds lists the newest start first", () => {
    const older = { id: "1794856633973" };
    const newer = { id: newRunId(1794856633974) };
    const oldest = { id: newRunId(1700000000000) };
    expect([older, oldest, newer].sort(newestRunFirst)).toEqual([newer, older, oldest]);
  });
});
