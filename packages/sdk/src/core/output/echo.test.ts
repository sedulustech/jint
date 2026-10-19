import { describe, expect, test } from "bun:test";
import { selectedElements, selectionEcho } from "./echo.ts";

const FIXTURE = "tests/fixtures/sample-file.ts";

describe("selectedElements (the element-scoped run's wire-shaped selection)", () => {
  test("an anchor resolves the element its line falls in: id, kind, name, span, content", async () => {
    const picked = await selectedElements({ path: FIXTURE, anchor: 3 });
    expect(picked.length).toBe(1);
    const s = picked[0]!;
    expect(s.id).toMatch(/^L\d+(-L\d+)?$/);
    expect(s.path).toBe(FIXTURE);
    expect(s.kind).toBe("function");
    expect(s.name).toBe("addSeconds");
    expect(s.spanStart).toBeLessThanOrEqual(3);
    expect(s.spanEnd).toBeGreaterThanOrEqual(3);
    expect(s.content).toContain("addSeconds");
  });

  test("a line inside no element resolves to nothing (the run fails ELEMENT_NOT_FOUND in-band)", async () => {
    expect(await selectedElements({ path: FIXTURE, anchor: 1000 })).toEqual([]);
  });

  test("a range resolves every fully-enclosed element, in order", async () => {
    const picked = await selectedElements({ path: FIXTURE, ranges: [{ start: 1, end: 200 }] });
    expect(picked.length).toBeGreaterThan(1);
    for (const s of picked) expect(s.id).toMatch(/^L\d+(-L\d+)?$/);
  });

  test("the stderr echo still renders headers and body for the same selection", async () => {
    const echo = await selectionEcho({ path: FIXTURE, anchor: 3 }, []);
    expect(echo.headers[0]).toContain("-> 1 element: ");
    expect(echo.body).toContain("--- " + FIXTURE + "@");
  });
});
