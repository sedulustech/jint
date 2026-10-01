import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { makeRouter, redirectLegacyHash } from "./router";

// Router acceptance, automated from the manual browser pass: URL is the state,
// so every test boots at an address and asserts on what renders + what the bar says.

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
afterEach(cleanup);

function mount() {
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={makeRouter()} />
    </QueryClientProvider>,
  );
}

// pushState + fresh router + fresh query client == a page load at this address
function boot(path: string) {
  window.history.pushState(null, "", path);
  mount();
}

async function openRun(name: RegExp) {
  await page.getByRole("combobox", { name: "run" }).click();
  await page.getByRole("option", { name }).click();
}

const reportPanel = () => document.getElementById("report-panel");
const detailPane = () => document.querySelector(".detail-pane")?.textContent ?? "";

async function expectPath(path: string) {
  await waitFor(() => {
    if (window.location.pathname + window.location.search !== path)
      throw new Error("url is " + window.location.pathname + window.location.search);
  });
}

test("boot at / shows the run picker, no run selected", async () => {
  boot("/");
  await page.getByRole("combobox", { name: "run" }).click();
  expect(window.location.pathname).toBe("/");
  expect(document.body.textContent).toContain("select a run");
});

test("deep link /runs/<id> renders that run", async () => {
  boot("/runs/run-a");
  await waitFor(
    () => {
      if (detailPane() !== "" || reportPanel() === null)
        throw new Error("run view not rendered yet");
    },
    { timeout: 10_000 },
  );
  expect(window.location.pathname).toBe("/runs/run-a");
});

test("?report=1 opens the panel, ?report=0 keeps it closed", async () => {
  boot("/runs/run-a?report=1");
  await waitFor(
    () => {
      if (reportPanel() === null) throw new Error("panel not open");
    },
    { timeout: 10_000 },
  );
  cleanup();

  boot("/runs/run-a?report=0");
  await waitFor(
    () => {
      if (document.body.innerText.includes("show report")) return;
      throw new Error("run view not rendered yet");
    },
    { timeout: 10_000 },
  );
  expect(reportPanel()).toBeNull();

  // D1 round trip: toggle writes the SAME spelling the validator accepts, and a
  // fresh boot (reload) reads it back
  const toggle = [...document.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("show report"),
  )!;
  toggle.click();
  await expectPath("/runs/run-a?report=1");
  cleanup();

  boot("/runs/run-a?report=1");
  await waitFor(
    () => {
      if (reportPanel() === null) throw new Error("panel state lost on reload");
    },
    { timeout: 10_000 },
  );
});

test("?rule+input deep link opens PairDetail and survives reload", async () => {
  boot("/runs/run-a?rule=is_name_purposeful&input=src/low.ts");
  await waitFor(
    () => {
      if (!detailPane().includes("@ src/low.ts")) throw new Error("pane not open");
    },
    { timeout: 10_000 },
  );
  expect(detailPane()).toContain("is_name_purposeful");
  cleanup();

  boot("/runs/run-a?rule=is_name_purposeful&input=src/low.ts");
  await waitFor(
    () => {
      if (!detailPane().includes("is_name_purposeful")) throw new Error("pane lost on reload");
    },
    { timeout: 10_000 },
  );
});

test("history walk: pick another run, back restores the previous run + panel state", async () => {
  boot("/runs/run-a?report=0");
  await waitFor(
    () => {
      if (!document.body.innerText.includes("show report"))
        throw new Error("run view not rendered yet");
    },
    { timeout: 10_000 },
  );

  await openRun(new RegExp("default rules"));
  await expectPath("/runs/run-0");
  expect(window.location.pathname).toBe("/runs/run-0");
  cleanup();

  window.history.back();
  await expectPath("/runs/run-a?report=0");
  mount();
  await waitFor(
    () => {
      if (reportPanel() !== null) throw new Error("panel state not restored from URL");
    },
    { timeout: 10_000 },
  );
});

test("legacy hash links rewrite to paths", () => {
  boot("/");

  window.location.hash = "#/runs/run-a";
  redirectLegacyHash();
  expect(window.location.pathname).toBe("/runs/run-a");
  expect(window.location.hash).toBe("");

  window.location.hash = "#runs/run-a";
  redirectLegacyHash();
  expect(window.location.pathname).toBe("/runs/run-a");
  expect(window.location.hash).toBe("");
});

test("config-less run carries the default-rules marker", async () => {
  boot("/");
  await page.getByRole("combobox", { name: "run" }).click();
  await page.getByRole("option", { name: /default rules/ }).click();
  await expectPath("/runs/run-0");
  expect(document.body.textContent).toContain("default rules");
});

test("unknown path renders inside the app shell, not a bare Not Found", async () => {
  boot("/definitely/not/a/route");
  await waitFor(
    () => {
      if (!document.body.textContent.includes("back to the runs"))
        throw new Error("chrome missing, body: " + document.body.innerHTML);
    },
    { timeout: 5_000 },
  );
  expect(document.body.textContent).not.toContain("Not Found");
});

test("invalid search params are stripped from the address bar", async () => {
  boot("/runs/run-a?report=2&bogus=1");
  await expectPath("/runs/run-a");
  expect(window.location.search).toBe("");
});
