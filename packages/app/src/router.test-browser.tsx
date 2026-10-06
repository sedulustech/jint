import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { makeRouter } from "./router";

// Router acceptance, automated from the manual browser pass: URL is the state,
// so every test boots at an address and asserts on what renders + what the bar says.

// staleTime Infinity: focus/interval refetches would flap the report toggle
// into its disabled (isLoading) state mid-click - fetch-on-mount is all we need
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

  await openRun(new RegExp("run-0"));
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
  expect(window.location.pathname + window.location.search).toBe("/runs/run-a?report=0");
});

test("config-less run carries the default-rules marker", async () => {
  boot("/");
  await page.getByRole("combobox", { name: "run" }).click();
  await page.getByRole("option", { name: /run-0/ }).click();
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

test("nonexistent run id renders the shared 404 inside the shell", async () => {
  boot("/runs/0000");
  await waitFor(
    () => {
      if (!document.body.textContent.includes("run 0000 not found"))
        throw new Error("404 copy missing");
    },
    { timeout: 10_000 },
  );
  expect(document.body.textContent).toContain("back to the runs");
  // app shell chrome: the header (jint, run picker, theme) stays up around the 404
  expect(document.querySelector("h1 svg")?.getAttribute("aria-label")).toBe("jint");
  expect(document.body.textContent).not.toContain("Not Found");
});

test("absent report.json: closed by default and never overridden open", async () => {
  // run-0 has no report.json: default = closed (the button reads "no report")
  boot("/runs/run-0");
  await waitFor(
    () => {
      if (!document.body.innerText.includes("no report"))
        throw new Error("run view not rendered yet");
    },
    { timeout: 10_000 },
  );
  expect(reportPanel()).toBeNull();
  cleanup();

  boot("/runs/run-0?report=0");
  await waitFor(
    () => {
      if (!document.body.innerText.includes("no report"))
        throw new Error("run view not rendered yet");
    },
    { timeout: 10_000 },
  );
  expect(reportPanel()).toBeNull();
  cleanup();

  // ?report=1 cannot conjure a missing report: absence wins over the override
  boot("/runs/run-0?report=1");
  await waitFor(
    () => {
      if (!document.body.innerText.includes("no report"))
        throw new Error("run view not rendered yet");
    },
    { timeout: 10_000 },
  );
  expect(reportPanel()).toBeNull();
});

test("deep history walk: back x2 + forward restores run, panel state and picker sync", async () => {
  boot("/runs/run-a?report=0");
  await waitFor(
    () => {
      if (!document.body.innerText.includes("show report"))
        throw new Error("run view not rendered yet");
    },
    { timeout: 10_000 },
  );

  // A -> B -> C: three real pushState entries from the dropdown
  await openRun(/run-1/);
  await expectPath("/runs/run-1");
  await waitFor(
    () => {
      if (reportPanel() === null) throw new Error("run-1 report should default open");
    },
    { timeout: 10_000 },
  );
  await openRun(/run-0/);
  await expectPath("/runs/run-0");
  await waitFor(
    () => {
      if (reportPanel() !== null) throw new Error("run-0 has no report");
    },
    { timeout: 10_000 },
  );

  // back x2: C -> B -> A, panel state restored from the URL at each step
  window.history.back();
  await expectPath("/runs/run-1");
  await waitFor(
    () => {
      if (reportPanel() === null) throw new Error("B panel state not restored");
    },
    { timeout: 10_000 },
  );
  window.history.back();
  await expectPath("/runs/run-a?report=0");
  await waitFor(
    () => {
      if (reportPanel() !== null) throw new Error("A panel state not restored");
    },
    { timeout: 10_000 },
  );

  // forward x1: A -> B again
  window.history.forward();
  await expectPath("/runs/run-1");
  await waitFor(
    () => {
      if (reportPanel() === null) throw new Error("forward lost B panel state");
    },
    { timeout: 10_000 },
  );

  // state-drift edge: the picker's selected value re-syncs with the URL (run-1)
  const trigger = page.getByRole("combobox", { name: "run" });
  await waitFor(
    () => {
      const text = (trigger.element() as HTMLElement).textContent ?? "";
      if (!text.includes("run-1")) throw new Error("picker stale: " + text);
    },
    { timeout: 10_000 },
  );
  expect((trigger.element() as HTMLElement).textContent ?? "").toContain("run-1");
});

// ---- interleaved param-group walk (test #10) --------------------------------
// report= lives in one param group, rule/input/file in another; independent
// writers must MERGE, never replace each other. Asserted end to end: clicks,
// toggles, back/forward, reload, close.

function modeButton(mode: string): HTMLElement {
  const b = document.querySelector<HTMLButtonElement>(`[data-testid="mode-${mode}"]`);
  if (b === null) throw new Error("mode button missing: " + mode);
  return b;
}

function rowByText(text: string): HTMLElement {
  const row = [
    ...document.querySelectorAll<HTMLElement>("section tr[role=button], section button"),
  ].find((b) => (b.textContent ?? []).includes(text));
  if (row === undefined) throw new Error("row not found: " + text);
  return row;
}

function detailClose(): HTMLElement {
  const b = [...document.querySelectorAll<HTMLElement>(".detail-pane button")].find((x) =>
    (x.textContent ?? "").includes("✕"),
  );
  if (b === undefined) throw new Error("detail close button missing");
  return b;
}

// The report toggle races its own history commit under the test harness (a
// click can land while the previous navigation is still committing); a real
// user just clicks again. Click until URL + panes agree with the target state.
async function toggleReport(target: "0" | "1") {
  for (let i = 0; i < 10; i++) {
    const want = target === "1";
    if (
      decodeURIComponent(window.location.search).includes("report=" + target) &&
      (reportPanel() !== null) === want &&
      detailPane() !== ""
    )
      return;
    const label = want ? "show report" : "hide report";
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent ?? "").includes(label),
    );
    if (b !== undefined) (b as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("toggle to report=" + target + " never settled: " + window.location.search);
}

// RAW comparison: urls under test are already in the router's wire encoding
async function expectUrl(url: string, tag = "?") {
  await waitFor(() => {
    if (window.location.pathname + window.location.search !== url)
      throw new Error("[" + tag + "] url is " + window.location.pathname + window.location.search);
  });
}

test("interleaved walk: report toggle and pair open merge into one URL across history", async () => {
  // T1: report open, no pair
  boot("/runs/run-a?report=1");
  await waitFor(
    () => {
      if (reportPanel() === null) throw new Error("report not open");
    },
    { timeout: 10_000 },
  );
  expect(detailPane()).toBe("");

  // T2: a real row click opens the pair; report=1 SURVIVES the merge
  modeButton("request").click();
  await waitFor(
    () => {
      if (rowByText("src/low.ts") === undefined) throw new Error("rows not ready");
    },
    { timeout: 10_000 },
  );
  rowByText("src/low.ts").click();
  await waitFor(
    () => {
      if (!detailPane().includes("@ src/low.ts")) throw new Error("pair not open");
    },
    { timeout: 10_000 },
  );
  await waitFor(() => {
    const q = decodeURIComponent(window.location.search);
    if (!/^\?report=1&rule=is_name_purposeful&input=src\/low\.ts&file=/.test(q))
      throw new Error("T2 url is " + q);
  });
  if (!window.location.search.includes("input=src%2Flow.ts"))
    throw new Error("T2 wire form lost the encoded input: " + window.location.search);
  expect(reportPanel()).not.toBeNull();

  // remember the exact pair group so later steps assert byte-identical merges
  const pairGroup = window.location.search.replace(/^\?report=1/, "");
  const urlAt = (report: string) => "?report=" + report + pairGroup;

  // T3: hide report; rule/input/file survive the toggle
  await toggleReport("0");
  await expectUrl("/runs/run-a" + urlAt("0"), "T3/T5/T6");
  await waitFor(
    () => {
      if (reportPanel() !== null) throw new Error("report not hidden");
      if (!detailPane().includes("@ src/low.ts")) throw new Error("pair lost on hide");
    },
    { timeout: 10_000 },
  );

  // T4: show report again - clean round trip
  await toggleReport("1");
  await expectUrl("/runs/run-a" + urlAt("1"), "T4/T5b");
  await waitFor(
    () => {
      if (reportPanel() === null) throw new Error("report not reopened");
    },
    { timeout: 10_000 },
  );

  // T5: back x1 -> T3 state; back x2 -> T2 state
  window.history.back();
  await expectUrl("/runs/run-a" + urlAt("0"), "T3/T5/T6");
  await waitFor(
    () => {
      if (reportPanel() !== null || !detailPane().includes("@ src/low.ts"))
        throw new Error("back-1 state wrong");
    },
    { timeout: 10_000 },
  );
  window.history.back();
  await expectUrl("/runs/run-a" + urlAt("1"), "T4/T5b");
  await waitFor(
    () => {
      if (reportPanel() === null || !detailPane().includes("@ src/low.ts"))
        throw new Error("back-2 state wrong");
    },
    { timeout: 10_000 },
  );

  // T6: forward x1 -> T3 state again (distinct entry, nothing collapsed)
  window.history.forward();
  await expectUrl("/runs/run-a" + urlAt("0"), "T3/T5/T6");
  await waitFor(
    () => {
      if (reportPanel() !== null || !detailPane().includes("@ src/low.ts"))
        throw new Error("forward state wrong");
    },
    { timeout: 10_000 },
  );

  // T7: reload - the full interleaved state survives
  cleanup();
  boot("/runs/run-a" + urlAt("0"));
  await waitFor(
    () => {
      if (reportPanel() !== null || !detailPane().includes("@ src/low.ts"))
        throw new Error("reload lost interleaved state");
    },
    { timeout: 10_000 },
  );

  // T8: close the pair -> back to exactly ?report=0, nothing dropped
  detailClose().click();
  await expectUrl("/runs/run-a?report=0");
  await waitFor(
    () => {
      if (detailPane() !== "") throw new Error("pair not closed");
    },
    { timeout: 10_000 },
  );
  expect(reportPanel()).toBeNull();
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
    // rule mode is the default: grouped empty state inside the intact shell
    boot("/runs/run-0");
    await waitFor(
      () => {
        if (!document.body.innerText.includes("no report — run captured without --json"))
          throw new Error("empty state missing");
      },
      { timeout: 10_000 },
    );
    expect(document.body.textContent).toContain("0 rules match your filters");
    expect(document.querySelector("h1 svg")?.getAttribute("aria-label")).toBe("jint");

    // file mode: same empty idiom, files noun
    modeButton("file").click();
    await waitFor(
      () => {
        if (!document.body.textContent.includes("0 files match your filters"))
          throw new Error("file empty state missing");
      },
      { timeout: 10_000 },
    );
    expect(document.body.textContent).toContain("no report — run captured without --json");
    expect(document.querySelector("h1 svg")?.getAttribute("aria-label")).toBe("jint");

    // request mode: the run's real request rows, from the raw captures
    modeButton("request").click();
    await waitFor(
      () => {
        const m = document.body.innerText.match(/(\d+) \/ (\d+) requests/);
        if (m === null) throw new Error("counter not rendered");
        if (m[1] !== "1" || m[2] !== "1") throw new Error("counter is " + m[0] + ", want 1/1");
      },
      { timeout: 10_000 },
    );
    expect(
      [...document.querySelectorAll("section tr[role=button]")].some((r) =>
        (r.textContent ?? "").includes("src/borderline.ts"),
      ),
    ).toBe(true);

    expect(errors).toEqual([]);
  } finally {
    // oxlint-disable-next-line no-console
    console.error = origError;
  }
});
