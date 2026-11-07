import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { makeRouter } from "./router";

// Router acceptance, automated from the manual browser pass: URL is the state,
// so every test boots at an address and asserts on what renders + what the bar says.

// staleTime Infinity: focus/interval refetches would flap loading states mid-click -
// fetch-on-mount is all we need
const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
afterEach(cleanup);

function mount() {
  const router = makeRouter();
  (window as unknown as { __testRouter: unknown }).__testRouter = router;
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// pushState + fresh router + fresh query client == a page load at this address
function boot(path: string) {
  window.history.pushState(null, "", path);
  mount();
}

async function openRun(id: string) {
  await page.getByTestId("run-picker").click();
  await page.getByTestId("run-option-" + id).click();
}

// the run view is rendered once its group-by controls are there
const runViewReady = () =>
  waitFor(
    () => {
      if (document.querySelector('[data-testid="mode-rule"]') === null)
        throw new Error("run view not rendered yet");
    },
    { timeout: 2_000 },
  );
const detailPane = () => document.querySelector(".detail-pane")?.textContent ?? "";

async function expectPath(path: string) {
  await waitFor(() => {
    if (window.location.pathname + window.location.search !== path)
      throw new Error("url is " + window.location.pathname + window.location.search);
  });
}

test("boot at / shows the run picker, no run selected", async () => {
  boot("/");
  await page.getByTestId("run-picker").click();
  expect(window.location.pathname).toBe("/");
  await waitFor(() => {
    if (document.querySelector('[data-testid="run-picker-heading"]') === null)
      throw new Error("run picker not rendered");
  });
});

test("deep link /runs/<id> renders that run", async () => {
  boot("/runs/run-a");
  await runViewReady();
  expect(detailPane()).toBe("");
  expect(window.location.pathname).toBe("/runs/run-a");
});

test("?rule+input deep link opens ClassificationDetail and survives reload", async () => {
  boot("/runs/run-a?rule=is_name_purposeful&input=src/low.ts");
  await waitFor(
    () => {
      if (!detailPane().includes("@ src/low.ts")) throw new Error("pane not open");
    },
    { timeout: 2_000 },
  );
  expect(detailPane()).toContain("is_name_purposeful");
  cleanup();

  boot("/runs/run-a?rule=is_name_purposeful&input=src/low.ts");
  await waitFor(
    () => {
      if (!detailPane().includes("is_name_purposeful")) throw new Error("pane lost on reload");
    },
    { timeout: 2_000 },
  );
});

test("history walk: pick another run, back restores the previous run", async () => {
  boot("/runs/run-a");
  await runViewReady();

  await openRun("run-0");
  await expectPath("/runs/run-0");
  cleanup();

  window.history.back();
  await expectPath("/runs/run-a");
  mount();
  await runViewReady();
  expect(window.location.pathname + window.location.search).toBe("/runs/run-a");
});

test("config-less run carries the default-rules marker", async () => {
  boot("/");
  await page.getByTestId("run-picker").click();
  await page.getByTestId("run-option-run-0").click();
  await expectPath("/runs/run-0");
  await waitFor(() => {
    const marker = document.querySelector('[data-testid="run-marker"]')?.textContent ?? "";
    if (!marker.includes("default rules")) throw new Error("marker missing, got: " + marker);
  });
  expect(document.querySelector('[data-testid="run-marker"]')?.textContent).toContain(
    "default rules",
  );
});

test("unknown path renders inside the app shell, not a bare Not Found", async () => {
  boot("/definitely/not/a/route");
  await waitFor(
    () => {
      const nf = document.querySelector('[data-testid="not-found"]')?.textContent ?? "";
      if (!nf.includes("back to the runs"))
        throw new Error("chrome missing, body: " + document.body.innerHTML);
    },
    { timeout: 2_000 },
  );
  expect(document.body.textContent).not.toContain("Not Found");
});

test("invalid search params are stripped from the address bar", async () => {
  boot("/runs/run-a?report=1&bogus=1");
  await expectPath("/runs/run-a");
  expect(window.location.search).toBe("");
});

test("nonexistent run id renders the shared 404 inside the shell", async () => {
  boot("/runs/0000");
  await waitFor(
    () => {
      const nf = document.querySelector('[data-testid="not-found"]')?.textContent ?? "";
      if (!nf.includes("run 0000 not found")) throw new Error("404 copy missing");
    },
    { timeout: 2_000 },
  );
  expect(document.querySelector('[data-testid="not-found"]')?.textContent).toContain(
    "back to the runs",
  );
  // app shell chrome: the header (jint, run picker, theme) stays up around the 404
  expect(document.querySelector("h1 svg")?.getAttribute("aria-label")).toBe("jint");
  expect(document.body.textContent).not.toContain("Not Found");
});

test("deep history walk: back x2 + forward restores the run and the picker sync", async () => {
  boot("/runs/run-a");
  await runViewReady();

  // A -> B -> C: three real pushState entries from the dropdown
  await openRun("run-1");
  await expectPath("/runs/run-1");
  await openRun("run-0");
  await expectPath("/runs/run-0");

  // back x2: C -> B -> A
  window.history.back();
  await expectPath("/runs/run-1");
  window.history.back();
  await expectPath("/runs/run-a");

  // forward x1: A -> B again
  window.history.forward();
  await expectPath("/runs/run-1");

  // state-drift edge: the picker's selected value re-syncs with the URL (run-1)
  const trigger = page.getByTestId("run-picker");
  await waitFor(
    () => {
      const text = (trigger.element() as HTMLElement).textContent ?? "";
      if (!text.includes("run-1")) throw new Error("picker stale: " + text);
    },
    { timeout: 2_000 },
  );
  expect((trigger.element() as HTMLElement).textContent ?? "").toContain("run-1");
});

// ---- classification walk -------------------------------------------------------------
// rule/input/file address the detail pane. Asserted end to end: a row click, back/forward,
// reload, close.

function modeButton(mode: string): HTMLElement {
  const b = document.querySelector<HTMLButtonElement>(`[data-testid="mode-${mode}"]`);
  if (b === null) throw new Error("mode button missing: " + mode);
  return b;
}

function requestRow(file: string): HTMLElement {
  const row = document.querySelector<HTMLElement>('[data-testid="request-' + file + '"]');
  if (row === null) throw new Error("request row missing: " + file);
  return row;
}

function detailClose(): HTMLElement {
  const b = document.querySelector<HTMLElement>(".detail-pane button[aria-label='close']");
  if (b === null) throw new Error("detail close button missing");
  return b;
}

// RAW comparison: urls under test are already in the router's wire encoding
async function expectUrl(url: string, tag = "?") {
  await waitFor(() => {
    if (window.location.pathname + window.location.search !== url)
      throw new Error("[" + tag + "] url is " + window.location.pathname + window.location.search);
  });
}

test("classification walk: a row click opens the classification, back/forward and reload keep it, close clears it", async () => {
  boot("/runs/run-a");
  await runViewReady();
  expect(detailPane()).toBe("");

  modeButton("request").click();
  await waitFor(
    () => {
      if (document.querySelector('[data-testid="request-src/low.ts"]') === null)
        throw new Error("rows not ready");
    },
    { timeout: 2_000 },
  );
  requestRow("src/low.ts").click();
  await waitFor(
    () => {
      if (!detailPane().includes("@ src/low.ts")) throw new Error("classification not open");
    },
    { timeout: 2_000 },
  );
  await waitFor(() => {
    const q = decodeURIComponent(window.location.search);
    if (!/^\?rule=is_name_purposeful&input=src\/low\.ts&file=/.test(q))
      throw new Error("url is " + q);
  });
  if (!window.location.search.includes("input=src%2Flow.ts"))
    throw new Error("wire form lost the encoded input: " + window.location.search);
  const opened = window.location.pathname + window.location.search;

  // back: the classification closes; forward: the same entry returns, nothing collapsed
  window.history.back();
  await expectUrl("/runs/run-a");
  await waitFor(
    () => {
      if (detailPane() !== "") throw new Error("back left the classification open");
    },
    { timeout: 2_000 },
  );
  window.history.forward();
  await expectUrl(opened);
  await waitFor(
    () => {
      if (!detailPane().includes("@ src/low.ts"))
        throw new Error("forward lost the classification");
    },
    { timeout: 2_000 },
  );

  // reload: the classification survives
  cleanup();
  boot(opened);
  await waitFor(
    () => {
      if (!detailPane().includes("@ src/low.ts")) throw new Error("reload lost the classification");
    },
    { timeout: 2_000 },
  );

  // close: back to the bare run address
  detailClose().click();
  await expectUrl("/runs/run-a");
  await waitFor(
    () => {
      if (detailPane() !== "") throw new Error("classification not closed");
    },
    { timeout: 2_000 },
  );
});

test("report-less run: grouped modes render the empty state, request mode the rows", async () => {
  // run-0: manifest + raw captures, NO report.json (a CLI run without --json).
  // Grouped modes derive from report cells -> empty; request mode reads the raw
  // files -> full rows. The contract: empty state, never a crash. Copy is
  // master's three-way split; run-0 is the no-json variant (not legacy).
  const errors: string[] = [];
  // oxlint-disable-next-line no-console
  const origError = console.error;
  // oxlint-disable-next-line no-console
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(" "));
    origError(...args);
  };
  try {
    // file mode is the default: grouped empty state inside the intact shell
    boot("/runs/run-0");
    await waitFor(
      () => {
        const empty = document.querySelector('[data-testid="empty-state"]')?.textContent ?? "";
        if (!empty.includes("no report — run captured without --json"))
          throw new Error("empty state missing, got: " + empty);
      },
      { timeout: 2_000 },
    );
    expect(document.querySelector('[data-testid="empty-state"]')?.textContent).toContain(
      "0 files match your filters",
    );
    expect(document.querySelector("h1 svg")?.getAttribute("aria-label")).toBe("jint");

    // file mode: same empty idiom, files noun
    modeButton("file").click();
    await waitFor(
      () => {
        const empty = document.querySelector('[data-testid="empty-state"]')?.textContent ?? "";
        if (!empty.includes("0 files match your filters"))
          throw new Error("file empty state missing, got: " + empty);
      },
      { timeout: 2_000 },
    );
    expect(document.querySelector('[data-testid="empty-state"]')?.textContent).toContain(
      "no report — run captured without --json",
    );
    expect(document.querySelector("h1 svg")?.getAttribute("aria-label")).toBe("jint");

    // request mode: the run's real request rows, from the raw captures
    modeButton("request").click();
    await waitFor(
      () => {
        const m = (document.querySelector('[data-testid="group-count"]')?.textContent ?? "").match(
          /(\d+) \/ (\d+) requests/,
        );
        if (m === null) throw new Error("counter not rendered");
        if (m[1] !== "1" || m[2] !== "1") throw new Error("counter is " + m[0] + ", want 1/1");
      },
      { timeout: 2_000 },
    );
    expect(document.querySelector('[data-testid="request-src/borderline.ts"]')).toBeTruthy();

    expect(errors).toEqual([]);
  } finally {
    // oxlint-disable-next-line no-console
    console.error = origError;
  }
});
