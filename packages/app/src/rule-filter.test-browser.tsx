import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { expect, test, afterEach } from "vitest";
import { page } from "vitest/browser";
import { App } from "./App";

// ---- PINNED FIXTURE CONSTANTS -------------------------------------------------
// Single source of test truth: tests/fixtures/ (regenerate via bun tests/helpers/build-fixture.ts).
// If these drift from the fixture, the fixture or the generator changed - update both together.
// run-b has NO manifest.json -> the handler hides it; the header must show the legacy note.
// captures in run-a
const TOTAL = 12;
const RULE_COUNTS: Record<string, number> = {
  // pinned: normal name / greedy-parser breaker / distinct name
  is_name_purposeful: 5,
  "has_nothing in mind": 3,
  will_comment_drift: 2,
};

// borderline 0.50, 0.51, 0.45 + multi (closest answer 0.3 -> distance 0.2)
const BORDERLINE_COUNT = 4;
// -------------------------------------------------------------------------------

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
afterEach(cleanup);

// text filter helpers: React-controlled input needs the native value setter
function setInput(value: string) {
  const input = document.querySelector(
    'input[placeholder*="filter"], input[type="text"], input[aria-label*="filter"]',
  );
  if (!input) throw new Error("filter input missing");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function clearInput() {
  setInput("");
}

function mount() {
  return render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>,
  );
}

function counter(): string {
  const m = document.body.innerText.match(/(\d+) \/ (\d+) requests/);
  if (!m) throw new Error("counter not found");
  return m[1];
}

// Options are labeled by the run's CONFIG basename (manifest-required picker); the run id is
// never rendered. NOW is the real wall clock, but assertions match the relative-time PATTERN
// ("... ago"), never a value - fixture mtimes are static.
async function openRun(configBasename = "sample.json") {
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: new RegExp(configBasename) }).click();
  await waitFor(
    () => {
      if (!counter()) throw new Error("counter not rendered");
    },
    { timeout: 20_000 },
  );
}

function reportRow(rule: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>("#report-panel tbody tr")].find((r) =>
    r.textContent?.includes(rule),
  );
  if (!row) throw new Error(`report row not found for ${rule}`);
  return row;
}

test("each report rule row filters the table to exactly its pinned count; click-again clears", async () => {
  mount();
  await openRun();
  for (const [rule, count] of Object.entries(RULE_COUNTS)) {
    reportRow(rule).click();
    await waitFor(
      () => {
        expect(counter()).toBe(String(count));
        expect(document.body.innerText).toContain(`rule: ${rule}`);
      },
      { timeout: 10_000 },
    );
    // click-again clears
    reportRow(rule).click();
    await waitFor(() => expect(counter()).toBe(String(TOTAL)), { timeout: 10_000 });
  }
});

test("chip x clears the rule filter", async () => {
  mount();
  await openRun();
  reportRow("will_comment_drift").click();
  await waitFor(() => expect(document.body.innerText).toContain("rule: will_comment_drift"), {
    timeout: 10_000,
  });
  const chip = [...document.querySelectorAll<HTMLElement>("button")].find((b) =>
    b.textContent?.trim().startsWith("rule: will_comment_drift"),
  );
  expect(chip).toBeTruthy();
  chip!.click();
  await waitFor(() => expect(counter()).toBe(String(TOTAL)), { timeout: 10_000 });
});

test("borderline band and text filters filter the table", async () => {
  mount();
  await openRun();

  const input = document.querySelector<HTMLInputElement>('input[placeholder*="filter"]')!;
  setNativeValue(input, "zzz-no-match");
  await waitFor(
    () => {
      expect(counter()).toBe("0");
      expect(document.body.innerText).toContain("0 requests match your filters");
    },
    { timeout: 10_000 },
  );
  setNativeValue(input, "");
  await waitFor(() => expect(counter()).toBe(String(TOTAL)), { timeout: 10_000 });

  const bb = [...document.querySelectorAll<HTMLElement>("button")].find(
    (b) => b.textContent?.trim() === "borderline",
  )!;
  bb.click();
  await waitFor(() => expect(counter()).toBe(String(BORDERLINE_COUNT)), { timeout: 10_000 });
  bb.click();
  await waitFor(() => expect(counter()).toBe(String(TOTAL)), { timeout: 10_000 });
});

test("the greedy-parser rule name filters exactly (regression: non-canonical parse drift)", async () => {
  mount();
  await openRun();
  const greedy = "has_nothing in mind";
  reportRow(greedy).click();
  await waitFor(
    () => {
      expect(counter()).toBe(String(RULE_COUNTS[greedy]));
      expect(document.body.innerText).toContain(`rule: ${greedy}`);
    },
    { timeout: 10_000 },
  );
  // a greedy parse would have produced "has_nothing", filtering to 0 or the wrong set
  reportRow(greedy).click();
  await waitFor(() => expect(counter()).toBe(String(TOTAL)), { timeout: 10_000 });
});

test("picker shows the config basename + relative time; no unix stamp anywhere", async () => {
  mount();
  await page.getByRole("combobox").click();
  const option = page.getByRole("option", { name: /sample\.json/ });
  await waitFor(
    () => {
      if (option.elements().length === 0) throw new Error("option missing");
    },
    { timeout: 15_000 },
  );
  const text = option.elements()[0]!.textContent ?? "";
  expect(text).toMatch(/sample\.json/);
  // formatDistanceToNowStrict(addSuffix) pattern, not a value
  expect(text).toMatch(/ago/);
  // no unix stamp in the label
  expect(text).not.toMatch(/17\d{11}/);
  expect(text).toContain("12 req");
});

test("legacy runs (no manifest.json) are hidden with a header note, never shown", async () => {
  mount();
  await waitFor(
    () => {
      if (
        !document.body.innerText.match(/\d+ \/ \d+ requests/) &&
        !document.body.innerText.includes("select a run")
      ) {
        throw new Error("app not ready");
      }
    },
    { timeout: 15_000 },
  );
  await page.getByRole("combobox").click();
  // run-b (no manifest) must not appear as an option
  expect(page.getByRole("option", { name: /3 req/ }).elements().length).toBe(0);
  // run-b: no manifest -> skipped
  expect(document.body.innerText).toContain("1 legacy run hidden");
});

function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

test("the header shows the selected run's absolute time at the top right", async () => {
  mount();
  await openRun();
  await waitFor(
    () => {
      const el = document.querySelector('[data-testid="header-time"]');
      if (!el || el.textContent === "") throw new Error("header time missing");
      // human-readable absolute: toLocaleString contains a date separator and time
      expect(el.textContent).toMatch(/\d{1,2}:\d{2}/);
    },
    { timeout: 10_000 },
  );
});

test("severity projects from the handle snapshot, never from the raw number", async () => {
  mount();
  await openRun();
  await waitFor(
    () => {
      if (!document.body.innerText.includes("12 / 12")) throw new Error("table not ready");
    },
    { timeout: 15_000 },
  );
  // fires_when:false rule: high p (0.92) is GOOD -> no verdict, no red, dash only
  await setInput("high.ts");
  await waitFor(
    () => {
      if (!document.body.innerText.includes("0.92")) throw new Error("row missing");
    },
    { timeout: 10_000 },
  );
  const rowText = [...document.querySelectorAll("button")]
    .map((b) => b.textContent ?? "")
    .find((tx) => tx.includes("0.92"));
  expect(rowText).toBeTruthy();
  // provable-verdict dash, NOT a severity label
  expect(rowText).toContain("—");
  expect(rowText).not.toMatch(/\b(error|warn)\b/);
  await clearInput();

  // pole flip: LOW p (0.08) under fires_when:false IS the defect -> error
  await setInput("low.ts");
  await waitFor(
    () => {
      if (!document.body.innerText.includes("0.08")) throw new Error("row missing");
    },
    { timeout: 10_000 },
  );
  const lowRow = [...document.querySelectorAll("button")]
    .map((b) => b.textContent ?? "")
    .find((tx) => tx.includes("0.08"));
  expect(lowRow).toContain("error");
  await clearInput();

  // silent_band: greedy capture at 0.8 sits inside [0.75, 0.85] -> silent (no verdict, not "clean")
  await setInput("greedy.ts");
  await waitFor(
    () => {
      if (!document.body.innerText.includes("0.80")) throw new Error("row missing");
    },
    { timeout: 10_000 },
  );
  const greedyRow = [...document.querySelectorAll("button")]
    .map((b) => b.textContent ?? "")
    .find((tx) => tx.includes("0.80"));
  expect(greedyRow).toContain("—");
  expect(greedyRow).not.toMatch(/\b(error|warn)\b/);
  await clearInput();

  // score rule: value 3 indexes the map at "error"
  await setInput("score.ts");
  await waitFor(
    () => {
      if (!document.body.innerText.includes("score.ts")) throw new Error("row missing");
    },
    { timeout: 10_000 },
  );
  const scoreRow = [...document.querySelectorAll("button")]
    .map((b) => b.textContent ?? "")
    .find((tx) => tx.includes("score.ts"));
  expect(scoreRow).toContain("error");
  await clearInput();
});

test("ACCEPTANCE: is_noul_documented noul 0.80 (fires_when false) renders neutral, never error", async () => {
  mount();
  await openRun();
  await setInput("documented.ts");
  await waitFor(
    () => {
      if (!document.body.innerText.includes("0.80")) throw new Error("row missing");
    },
    { timeout: 15_000 },
  );
  const row = [...document.querySelectorAll("button")]
    .map((b) => b.textContent ?? "")
    .find((tx) => tx.includes("0.80") && tx.includes("documented.ts"));
  expect(row).toBeTruthy();
  // the verdict comes from the handle snapshot (defect pole 0.2 < warn_at 0.6), NOT the raw 0.8
  expect(row).toContain("—");
  expect(row).not.toMatch(/\berror\b/);
  await clearInput();
});
