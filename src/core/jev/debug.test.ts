import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { requestDebug, requestTapSummary } from "./debug.ts";

const DIR = "tmp/jev-request-test";

function listCaptures(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory())
      out.push(...listCaptures(`${dir}/${entry.name}`).map((f) => `${entry.name}/${f}`));
    else out.push(entry.name);
  }
  return out.sort();
}

function passthrough(): (input: string, init?: RequestInit) => Promise<Response> {
  return async () =>
    new Response(JSON.stringify({ model: "jev-1.0", answers: {}, usage: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

async function captureOnce(
  config: ReturnType<typeof requestDebug>,
  state: Record<string, unknown>,
): Promise<void> {
  await config.fetch!("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    body: JSON.stringify({
      state,
      questions: { is_name_purposeful: { type: "noul", instructions: "names are precise" } },
      model: "jev-latest",
    }),
  });
}

beforeEach(() => {
  process.env.JEV_DEBUG_REQUEST = "1";
  process.env.JEV_DEBUG_REQUEST_LOCATION = DIR;
  rmSync(DIR, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.JEV_DEBUG_REQUEST;
  delete process.env.JEV_DEBUG_REQUEST_LOCATION;
  rmSync(DIR, { recursive: true, force: true });
});

describe("requestDebug", () => {
  test("disabled without JEV_DEBUG_REQUEST: config passes through untouched", () => {
    delete process.env.JEV_DEBUG_REQUEST;
    const config = requestDebug(undefined);
    expect(config.fetch).toBeUndefined();
  });

  test("writes one pretty-printed capture per call, named <unixts>-<kind>-<file>.json", async () => {
    const config = requestDebug({ fetch: passthrough() });
    await captureOnce(config, { path: "src/a.ts", content: "export const x = 1;" });

    const list = listCaptures(DIR);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatch(/^\d+\/\d+-files-a\.ts\.json$/);

    const capture = JSON.parse(readFileSync(`${DIR}/${list[0]}`, "utf8"));
    expect(capture.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(capture.status).toBe(200);
    expect(capture.request.state.path).toBe("src/a.ts");
    expect(capture.request.model).toBe("jev-latest");
    expect(capture.response.model).toBe("jev-1.0");
  });

  test("state shape drives the kind: single-element source -> elements, else files", async () => {
    const config = requestDebug({ fetch: passthrough() });
    await captureOnce(config, { path: "a.ts", source: "x" });
    await captureOnce(config, { path: "b.ts", content: "x" });

    const list = listCaptures(DIR);
    expect(list.some((f) => f.endsWith("-elements-a.ts.json"))).toBe(true);
    expect(list.some((f) => f.endsWith("-files-b.ts.json"))).toBe(true);
  });

  test("same-millisecond collisions get a suffix, never concatenated", async () => {
    const config = requestDebug({ fetch: passthrough() });
    const body = JSON.stringify({
      state: { path: "a.ts", content: "x" },
      questions: { q: { type: "noul", instructions: "x" } },
    });
    await Promise.all([
      config.fetch!("https://api.typesafe.ai/v1/systemone", { method: "POST", body }),
      config.fetch!("https://api.typesafe.ai/v1/systemone", { method: "POST", body }),
      config.fetch!("https://api.typesafe.ai/v1/systemone", { method: "POST", body }),
    ]);

    const list = listCaptures(DIR);
    expect(list).toHaveLength(3);
    for (const f of list) {
      expect(() => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"))).not.toThrow();
    }
  });

  test("a failing tap never breaks the observed call", async () => {
    process.env.JEV_DEBUG_REQUEST_LOCATION = "/proc/definitely-not-writable";
    const config = requestDebug({ fetch: passthrough() });
    const response = await config.fetch!("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      body: JSON.stringify({ state: { path: "a.ts", content: "x" }, questions: {} }),
    });
    expect(response.status).toBe(200);
  });

  test("summary: dir + written count after captures (override location flagged)", async () => {
    const config = requestDebug({ fetch: passthrough() });
    expect(requestTapSummary()).toEqual({ dir: expect.any(String), count: 0, override: true });

    await captureOnce(config, { path: "a.ts", content: "x" });
    await captureOnce(config, { path: "a.ts", content: "x" });

    const summary = requestTapSummary()!;
    expect(summary.dir).toMatch(
      new RegExp(`^${DIR.replace(/[.*+?^{}()|[\]\\]/g, "\\\\$&")}/\\d+$`),
    );
    expect(summary.count).toBe(2);
    expect(summary.override).toBe(true);
  });

  test("summary: no override flag when the location is the default", async () => {
    delete process.env.JEV_DEBUG_REQUEST_LOCATION;
    const config = requestDebug({ fetch: passthrough() });
    await captureOnce(config, { path: "a.ts", content: "x" });
    expect(requestTapSummary()!.override).toBe(false);
  });

  test("summary: inactive tap exposes nothing", () => {
    delete process.env.JEV_DEBUG_REQUEST;
    requestDebug(undefined);
    expect(requestTapSummary()).toBeNull();
  });
});
