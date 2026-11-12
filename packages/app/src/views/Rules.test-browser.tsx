import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { makeRouter } from "../router";

// The rules page: every rule of the repo's config, filtered by type, with a read-only dialog.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rules = [
  {
    name: "has_x",
    kind: "noul",
    instructions: "Is x here?",
    criteria: { true: "x is here", false: "x is absent" },
    handle: { warn: { greater_than: 0.5 }, error: { greater_than: 0.75, message: "Remove x." } },
    runs: [{ id: "1700000000123456", n: 4, fired: 1, cached: 2 }],
  },
  {
    name: "is_hard",
    kind: "score",
    instructions: "How hard is it?",
    criteria: ["easy", "hard"],
    handle: { map: ["pass", { level: "error", message: "Simplify." }] },
    runs: [{ id: "1700000000123457", n: 2, fired: 0, cached: 0 }],
  },
  {
    name: "is_unseen",
    kind: "noul",
    criteria: { true: "t", false: "f" },
    handle: { warn: { less_than: 0.5 } },
    runs: [],
  },
];

function boot() {
  const real = window.fetch.bind(window);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/rules")
      return Promise.resolve(Response.json({ configPath: "/x/jint.config.ts", rules }));
    if (url === "/api/runs") return Promise.resolve(Response.json({ runs: [] }));
    return real(input, init);
  });
  window.history.pushState(null, "", "/rules");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={makeRouter()} />
    </QueryClientProvider>,
  );
}

const rowCount = () => document.querySelectorAll('[data-testid="rule-row"]').length;
const testId = (id: string) => document.querySelector(`[data-testid="${id}"]`);

test("the type filters narrow the list and never ran keeps the rules with no run", async () => {
  boot();
  await waitFor(() => expect(rowCount()).toBe(3));
  fireEvent.click(testId("rules-filter-score") as Element);
  expect(rowCount()).toBe(1);
  fireEvent.click(testId("rules-filter-never") as Element);
  expect(rowCount()).toBe(1);
  expect(testId("rule-last-run")?.textContent).toBe("never");
});

test("a noul rule's dialog shows its thresholds; a score rule's shows its levels instead", async () => {
  boot();
  await waitFor(() => expect(rowCount()).toBe(3));
  fireEvent.click(document.querySelectorAll('[data-testid="rule-open"]')[0] as Element);
  await waitFor(() => expect(testId("rule-dialog")).not.toBeNull());
  expect(testId("rule-instructions")?.textContent).toBe("Is x here?");
  expect(testId("rule-dialog")?.querySelectorAll('[data-testid="rule-bar"]').length).toBe(1);
  fireEvent.keyDown(document.body, { key: "Escape" });
  await waitFor(() => expect(testId("rule-dialog")).toBeNull());
  fireEvent.click(document.querySelectorAll('[data-testid="rule-open"]')[1] as Element);
  await waitFor(() => expect(testId("rule-dialog")).not.toBeNull());
  expect(testId("rule-dialog")?.querySelectorAll('[data-testid="rule-bar"]').length).toBe(0);
  expect(testId("rule-criteria")?.textContent).toContain("hard → error");
});
