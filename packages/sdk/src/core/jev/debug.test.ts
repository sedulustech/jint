import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { ID_HEADER, recordRequests, recordSummary } from "./debug.ts";

const DIR = "tmp/jev-record-test";

function listRequests(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory())
      out.push(...listRequests(`${dir}/${entry.name}`).map((f) => `${entry.name}/${f}`));
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

async function recordOnce(
  config: ReturnType<typeof recordRequests>,
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

// Recording is ALWAYS-ON, so every test pins JINT_RUNS_DIR at the tmp store; the one default-location
// test repoints HOME instead, so nothing ever lands in the real ~/.jint/runs.
beforeEach(() => {
  process.env.JINT_RUNS_DIR = DIR;
  rmSync(DIR, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.JINT_RUNS_DIR;
  delete process.env.HOME;
  rmSync(DIR, { recursive: true, force: true });
});

describe("recordRequests", () => {
  test("records by default, no env required: the run dir sits under the homedir store", () => {
    delete process.env.JINT_RUNS_DIR;
    recordRequests({ fetch: passthrough() });
    // dir is computed lazily; nothing is written until the first call, so this asserts the
    // default LOCATION without touching the real ~/.jint/runs
    expect(recordSummary()!.dir).toMatch(/^.*\/\.jint\/runs\/\d+$/);
    expect(recordSummary()!.override).toBe(false);
  });

  test("a JINT_RUNS_DIR override moves the run dir; recording is always on", async () => {
    const config = recordRequests({ fetch: passthrough() });
    expect(recordSummary()).not.toBeNull();
    await recordOnce(config, { path: "a.ts", content: "x" });
    expect(listRequests(DIR)).toHaveLength(1);
  });

  test("writes one pretty-printed request per call, named <unixts>-<kind>-<file>.json", async () => {
    const config = recordRequests({ fetch: passthrough() });
    await recordOnce(config, { path: "src/a.ts", content: "export const x = 1;" });

    const list = listRequests(DIR);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatch(/^\d+\/\d+-files-a\.ts\.json$/);

    const request = JSON.parse(readFileSync(`${DIR}/${list[0]}`, "utf8"));
    expect(request.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(request.status).toBe(200);
    expect(request.request.state.path).toBe("src/a.ts");
    expect(request.request.model).toBe("jev-latest");
    expect(request.response.model).toBe("jev-1.0");
  });

  test("the state's id, sent beside the state in a header, is kept in the record", async () => {
    const config = recordRequests({ fetch: passthrough() });
    await config.fetch!("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { [ID_HEADER]: "0f6c" },
      body: JSON.stringify({ state: { path: "a.ts", source: "x" }, questions: {}, model: "m" }),
    });
    const request = JSON.parse(readFileSync(`${DIR}/${listRequests(DIR)[0]}`, "utf8"));
    expect(request.id).toBe("0f6c");
    expect(request.request.state.id).toBeUndefined();
  });

  test("state shape drives the kind: single-element source -> elements, else files", async () => {
    const config = recordRequests({ fetch: passthrough() });
    await recordOnce(config, { path: "a.ts", source: "x" });
    await recordOnce(config, { path: "b.ts", content: "x" });

    const list = listRequests(DIR);
    expect(list.some((f) => f.endsWith("-elements-a.ts.json"))).toBe(true);
    expect(list.some((f) => f.endsWith("-files-b.ts.json"))).toBe(true);
  });

  test("same-millisecond collisions get a suffix, never concatenated", async () => {
    const config = recordRequests({ fetch: passthrough() });
    const body = JSON.stringify({
      state: { path: "a.ts", content: "x" },
      questions: { q: { type: "noul", instructions: "x" } },
    });
    await Promise.all([
      config.fetch!("https://api.typesafe.ai/v1/systemone", { method: "POST", body }),
      config.fetch!("https://api.typesafe.ai/v1/systemone", { method: "POST", body }),
      config.fetch!("https://api.typesafe.ai/v1/systemone", { method: "POST", body }),
    ]);

    const list = listRequests(DIR);
    expect(list).toHaveLength(3);
    for (const f of list) {
      expect(() => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"))).not.toThrow();
    }
  });

  test("a failing store never breaks the observed call", async () => {
    process.env.JINT_RUNS_DIR = "/proc/definitely-not-writable";
    const config = recordRequests({ fetch: passthrough() });
    const response = await config.fetch!("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      body: JSON.stringify({ state: { path: "a.ts", content: "x" }, questions: {} }),
    });
    expect(response.status).toBe(200);
  });

  test("summary: dir + written count after recording (override location flagged)", async () => {
    const config = recordRequests({ fetch: passthrough() });
    expect(recordSummary()).toEqual({ dir: expect.any(String), count: 0, override: true });

    await recordOnce(config, { path: "a.ts", content: "x" });
    await recordOnce(config, { path: "a.ts", content: "x" });

    const summary = recordSummary()!;
    expect(summary.dir).toMatch(
      new RegExp(`(.*?)${DIR.replace(/[.*+?^{}()|[\]\\]/g, "\\$&")}/\\d+$`),
    );
    expect(summary.count).toBe(2);
    expect(summary.override).toBe(true);
  });
});
