import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { makeRouter } from "../router";

// tests/fixtures/run-a/report.json carries one error that names its rule:
// is_name_purposeful at src/multi.tsx#E1, a pair with a recorded request
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
afterEach(cleanup);

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

test("an error that names its rule opens that pair's request in a dialog", async () => {
  window.history.pushState(null, "", "/runs/run-a");
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={makeRouter()} />
    </QueryClientProvider>,
  );
  await page.getByTestId("run-errors-toggle").click();
  await page.getByTestId("run-error-open").click();
  await waitFor(() => {
    if (dialog()?.querySelector('[data-testid="close-pair"]') == null)
      throw new Error("pair detail not in the dialog");
  });
  const close = dialog()!.querySelector<HTMLElement>('[data-testid="close-pair"]')!;
  expect(close).not.toBeNull();
  close.click();
  await waitFor(() => {
    if (dialog() !== null) throw new Error("dialog still open");
  });
  expect(dialog()).toBeNull();
});
