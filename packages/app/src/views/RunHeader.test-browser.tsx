import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { makeRouter } from "../router";

// The header's labeled figures: tokens, cost and how many answers the cache served.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const classification = (n: number, cached: boolean) => ({
  rule: "is_x",
  input: `src/f${n}.ts`,
  value: 0.1,
  cached: cached ? true : undefined,
});

function bootRun(classifications: unknown[], usage: { input: number; output: number }) {
  const run = {
    id: "1700000000000",
    mtime: new Date().toISOString(),
    requests: 0,
    ruleCount: 1,
    configPath: "/x/jint.config.ts",
    model: "gpt-6-luna",
    durationMs: 164,
    usage,
    cost: 0,
  };
  const real = window.fetch.bind(window);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown) => Promise.resolve(Response.json(body));
    if (url.endsWith("/report")) return json({ classifications, findings: [], errors: [] });
    if (url === "/api/runs") return json({ runs: [run] });
    if (url === `/api/runs/${run.id}`) {
      return json({
        id: run.id,
        requestCount: 0,
        hasReport: true,
        results: [],
        handles: {},
        cells: [],
        reportDegraded: false,
      });
    }
    return real(input, init);
  });
  window.history.pushState(null, "", `/runs/${run.id}`);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={makeRouter()} />
    </QueryClientProvider>,
  );
}

const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;

test("a run answered wholly from the cache reads cached 2/2 beside its zero usage", async () => {
  bootRun([classification(1, true), classification(2, true)], { input: 0, output: 0 });
  await waitFor(() => {
    if (text("run-cached") === null) throw new Error("no cached figure yet");
  });
  expect(text("run-cached")).toBe("2/2");
  expect(text("run-tokens")).toBe("0 in / 0 out");
});

test("a mixed run counts only the cached answers", async () => {
  bootRun([classification(1, true), classification(2, false), classification(3, false)], {
    input: 900,
    output: 12,
  });
  await waitFor(() => {
    if (text("run-cached") === null) throw new Error("no cached figure yet");
  });
  expect(text("run-cached")).toBe("1/3");
});
