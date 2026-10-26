import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { makeRouter } from "../router";

// tests/fixtures/run-a/report.json carries one error that names its rule:
// is_name_purposeful at src/multi.tsx#E1, a pair with a recorded request
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
afterEach(cleanup);

const ERROR_ADDRESS = "?rule=is_name_purposeful&input=src%2Fmulti.tsx%23E1";

// pushState + fresh router == a page load at this address
function boot(path: string) {
  window.history.pushState(null, "", path);
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={makeRouter()} />
    </QueryClientProvider>,
  );
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const errorList = () => document.getElementById("run-errors");
const toggle = () => document.querySelector<HTMLElement>('[data-testid="run-errors-toggle"]');
const url = () => window.location.pathname + window.location.search;

async function until(check: () => boolean, what: string) {
  await waitFor(
    () => {
      if (!check()) throw new Error(what + " (url " + url() + ")");
    },
    { timeout: 2_000 },
  );
}

const pairInDialog = () => dialog()?.querySelector('[data-testid="close-pair"]') != null;

test("the warning toggle walks the run route to /errors and back", async () => {
  boot("/runs/run-a");
  await until(() => toggle() !== null, "toggle not rendered");
  expect(toggle()!.getAttribute("aria-expanded")).toBe("false");
  expect(errorList()).toBeNull();

  await page.getByTestId("run-errors-toggle").click();
  await until(() => url() === "/runs/run-a/errors" && errorList() !== null, "list not open");
  expect(toggle()!.getAttribute("aria-expanded")).toBe("true");

  await page.getByTestId("run-errors-toggle").click();
  await until(() => url() === "/runs/run-a" && errorList() === null, "list not closed");
  expect(toggle()!.getAttribute("aria-expanded")).toBe("false");
});

test("/errors opens the list without a dialog", async () => {
  boot("/runs/run-a/errors");
  await until(() => errorList() !== null, "list not open");
  expect(toggle()!.getAttribute("aria-expanded")).toBe("true");
  expect(dialog()).toBeNull();
  expect(document.querySelector('[data-testid="run-error-missing"]')).toBeNull();
});

test("an error row opens its pair at /errors?rule&input; closing returns to /errors", async () => {
  boot("/runs/run-a/errors");
  await page.getByTestId("run-error-open").click();
  await until(() => url() === "/runs/run-a/errors" + ERROR_ADDRESS, "row did not address the pair");
  await until(pairInDialog, "pair detail not in the dialog");

  dialog()!.querySelector<HTMLElement>('[data-testid="close-pair"]')!.click();
  await until(() => url() === "/runs/run-a/errors" && dialog() === null, "dialog still open");
  expect(errorList()).not.toBeNull();
});

test("/errors?rule&input deep-links the dialog; Escape and Back both close it", async () => {
  boot("/runs/run-a/errors" + ERROR_ADDRESS);
  await until(pairInDialog, "pair detail not in the dialog");
  // the pair address belongs to the dialog: the pane under it stays closed
  expect(document.querySelector('[aria-label="resize rules and result panes"]')).toBeNull();

  await userEvent.keyboard("{Escape}");
  await until(() => url() === "/runs/run-a/errors" && dialog() === null, "Escape did not close");
  cleanup();

  window.history.pushState(null, "", "/runs/run-a/errors");
  boot("/runs/run-a/errors" + ERROR_ADDRESS);
  await until(pairInDialog, "pair detail not in the dialog");
  window.history.back();
  await until(() => url() === "/runs/run-a/errors" && dialog() === null, "Back did not close");
  expect(errorList()).not.toBeNull();
});

test("an address that matches no error shows the list and no dialog", async () => {
  boot("/runs/run-a/errors?rule=is_name_purposeful&input=src%2Fnowhere.ts");
  await until(
    () => document.querySelector('[data-testid="run-error-missing"]') !== null,
    "no-such-error line missing",
  );
  expect(errorList()).not.toBeNull();
  expect(dialog()).toBeNull();
});
