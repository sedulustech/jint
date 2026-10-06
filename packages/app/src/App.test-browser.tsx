import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { router } from "./router";

// App mounts against the real /api/* handler over tests/fixtures (see vitest.config.ts).
const mount = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  window.history.pushState(null, "", " ");
});

test("a pre-set /runs/<id> deep link selects that run", async () => {
  const { runs } = await (await fetch("/api/runs")).json();
  expect(runs.length).toBeGreaterThan(0);
  window.history.pushState(null, "", `/runs/${runs[0].id}`);

  mount();

  // radix only clears data-placeholder once the state value is set
  const trigger = await screen.findByLabelText("run", undefined, { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 300));
  expect(trigger.getAttribute("data-placeholder")).toBeNull();
  // the slimmed trigger shows the run's LABEL; the full identity moved to RunHeader
  const first = runs[0];
  const label = first.legacy ? "migrated run" : (first.cwd ?? first.configPath ?? "default rules");
  expect(trigger.textContent).toContain(label);
});

test("picking a run writes the path", async () => {
  const { runs } = await (await fetch("/api/runs")).json();
  mount();

  // radix select opens on keydown; keyboard is also the path that avoids pointer quirks
  const trigger = await screen.findByLabelText("run", undefined, { timeout: 5000 });
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(
    await screen.findByRole("option", { name: new RegExp(runs[0].id) }, { timeout: 3000 }),
  );
  expect(window.location.pathname).toBe(`/runs/${runs[0].id}`);
});
