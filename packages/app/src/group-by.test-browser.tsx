import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { expect, test, afterEach } from "vitest";
import { page } from "vitest/browser";
import { App } from "./App";

// ---- PINNED FIXTURE CONSTANTS (tests/fixtures/run-a: 15 captures + report.json, 12 cells) ----
// severity comes from the span-aware join: findings first, handle projection second.
// 15 cells across 13 files.
// is_name_purposeful: 0.5 warn (finding), 0.92 null, 0.08 error, 0.51 warn, 0.7 null -> 5 cells
// "has_nothing in mind": 0.8 silent, 0.2 null, 0.3 null -> 3 cells, all no-verdict
// will_comment_drift: 0.95 error (>0.9), 0.45 null -> 2 cells
// will_error_lose_cause: score 3 -> error (x2); is_noul_documented: 0.8 -> null
const RULES = 6;
// src/none.ts has no measurements -> no cell, no group
const FILES = 13;
// ----------------------------------------------------------------------------------------------

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
afterEach(cleanup);

function mount() {
  return render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>,
  );
}

function counter(): string {
  const m = document.body.innerText.match(/(\d+) \/ (\d+) (requests|rules|files)/);
  if (!m) throw new Error("counter not found");
  return m[1] + "/" + m[2] + " " + m[3];
}

async function openRun() {
  await page.getByRole("combobox", { name: "run" }).click();
  await page.getByRole("option", { name: /sample\.json/ }).click();
  await waitFor(
    () => {
      if (!counter()) throw new Error("counter not rendered");
    },
    { timeout: 20_000 },
  );
}

function modeButton(mode: string): HTMLElement {
  const b = document.querySelector<HTMLButtonElement>(`[data-testid="mode-${mode}"]`);
  if (!b) throw new Error("mode button missing: " + mode);
  return b;
}

function rowByText(text: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>("section button")].find((b) =>
    (b.textContent ?? []).includes(text),
  );
  if (!row) throw new Error("row not found: " + text);
  return row;
}

async function setInput(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[placeholder*="filter"]');
  if (!input) throw new Error("filter input missing");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function expectCounter(expected: string) {
  await waitFor(
    () => {
      if (counter() !== expected) throw new Error("counter is " + counter());
    },
    { timeout: 10_000 },
  );
}

test("request mode is the capture log: max-p column, no borderline button, no rule chip", async () => {
  mount();
  await openRun();
  await expectCounter("15/15 requests");
  expect(document.body.innerText).toContain("max-p");
  expect(
    [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "borderline"),
  ).toBe(false);
  expect(
    [...document.querySelectorAll("button")].some((b) =>
      (b.textContent ?? "").startsWith("rule: "),
    ),
  ).toBe(false);
});

test("the group-by toggle renders all three modes", async () => {
  mount();
  await openRun();
  modeButton("rule").click();
  await expectCounter(RULES + "/" + RULES + " rules");
  modeButton("file").click();
  await expectCounter(FILES + "/" + FILES + " files");
  modeButton("request").click();
  await expectCounter("15/15 requests");
  expect(document.body.innerText).toContain("max-p");
});

test("rule parents expand into cells; cell values sit on the rule's own scale", async () => {
  mount();
  await openRun();
  modeButton("rule").click();
  // default: sev desc -> an error-carrying rule parents first
  await waitFor(() => expect(document.body.innerText).toContain("5 targets"), { timeout: 10_000 });
  const parent = rowByText("is_name_purposeful");
  expect(parent.getAttribute("aria-expanded")).toBe("false");
  parent.click();
  await waitFor(
    () => {
      if (!document.body.innerText.includes("(file)")) throw new Error("children missing");
    },
    { timeout: 10_000 },
  );
  expect(parent.getAttribute("aria-expanded")).toBe("true");
  // the rule's own 0.08 reading is visible as a cell value (never max-p across questions)
  expect(document.body.innerText).toContain("0.08");
  // parent click again collapses
  rowByText("is_name_purposeful").click();
  await waitFor(
    () => {
      if (document.body.innerText.includes("(file)")) throw new Error("children still visible");
    },
    { timeout: 10_000 },
  );
});

test("file mode parents expand; file-level cells render as explicit (file) rows", async () => {
  mount();
  await openRun();
  modeButton("file").click();
  await expectCounter(FILES + "/" + FILES + " files");
  rowByText("src/multi.tsx").click();
  await waitFor(
    () => {
      if (!document.body.innerText.includes("is_name_purposeful")) {
        throw new Error("cells missing under file parent");
      }
    },
    { timeout: 10_000 },
  );
  // multi.tsx holds two cells (two rules), both element-tier inputs (path#span)
  const children = [...document.querySelectorAll("button")].filter((b) =>
    (b.textContent ?? "").includes("#E1"),
  );
  expect(children.length).toBe(2);
});

test("a cell click opens PairDetail addressed by (rule, input)", async () => {
  mount();
  await openRun();
  modeButton("rule").click();
  await expectCounter(RULES + "/" + RULES + " rules");
  rowByText("is_name_purposeful").click();
  await waitFor(() => expect(document.body.innerText).toContain("0.08"), { timeout: 10_000 });
  rowByText("0.08").click();
  await waitFor(
    () => {
      const d = document.body.innerText;
      if (!d.includes("is_name_purposeful @ src/low.ts")) throw new Error("pair detail not open");
    },
    { timeout: 10_000 },
  );
  // the single answer's value + its own verdict, never a sibling's
  await waitFor(
    () => {
      const pane = document.querySelector(".detail-pane")?.textContent ?? "";
      if (!pane.includes("0.08") || !pane.includes("error"))
        throw new Error("verdict missing, pane: " + pane.slice(0, 200));
    },
    { timeout: 10_000 },
  );
  // closing returns to the table
  const close = [...document.querySelectorAll("button")].find((b) => b.textContent === "✕");
  close!.click();
  await waitFor(() => expect(document.body.innerText).toContain("group by"), { timeout: 10_000 });
});

test("text filter matches cells: only parents with a matching child survive", async () => {
  mount();
  await openRun();
  modeButton("rule").click();
  await expectCounter(RULES + "/" + RULES + " rules");
  await setInput("src/low.ts");
  await expectCounter("1/1 rules");
  // expanding the surviving group shows the matching child, not the whole rule
  rowByText("is_name_purposeful").click();
  await waitFor(
    () => {
      const rows = [...document.querySelectorAll("button")].filter((b) =>
        (b.textContent ?? "").includes("(file)"),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.textContent).toContain("0.08");
    },
    { timeout: 10_000 },
  );
});

test("severity column sorts by rank error > warn > pass, never lexicographically", async () => {
  mount();
  await openRun();
  modeButton("rule").click();
  await expectCounter(RULES + "/" + RULES + " rules");
  // initial state: sev desc (error-first), name asc within a rank -> complex parents first
  const firstParent = (): string =>
    [...document.querySelectorAll("button")]
      .map((b) => b.textContent ?? "")
      .find((t) => t.includes("targets") || t.includes("rules ·"))!;
  expect(firstParent()).toContain("is_cognitively_complex");
  // toggle sev asc: the no-verdict groups rise to the top
  const sevHeader = [...document.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").startsWith("sev"),
  );
  sevHeader!.click();
  await waitFor(
    () => {
      if (!firstParent().includes("has_nothing in mind")) {
        throw new Error("asc order not applied, first is: " + firstParent());
      }
    },
    { timeout: 10_000 },
  );
});

test("a report-panel rule click switches to rule mode, expands + scrolls to the group", async () => {
  mount();
  await openRun();
  const reportRow = [...document.querySelectorAll<HTMLElement>("#report-panel tbody tr")].find(
    (r) => r.textContent?.includes("has_nothing in mind"),
  );
  expect(reportRow).toBeTruthy();
  reportRow!.click();
  await waitFor(
    () => {
      if (!counter().endsWith("rules")) throw new Error("not in rule mode");
    },
    { timeout: 10_000 },
  );
  // the clicked rule's group is expanded (3 children, all no-verdict silent-band values)
  await waitFor(
    () => {
      const rows = [...document.querySelectorAll("button")].filter((b) =>
        (b.textContent ?? "").includes("has_nothing in mind"),
      );
      if (rows.length < 4) throw new Error("group not expanded, rows: " + rows.length);
    },
    { timeout: 10_000 },
  );
  // 6 parents + 3 expanded children
  expect(counter()).toBe("9/" + RULES + " rules");
});

test("request rows still drill in: a request click opens the pair detail of its first pair", async () => {
  mount();
  await openRun();
  await expectCounter("15/15 requests");
  rowByText("low.ts").click();
  await waitFor(
    () => {
      if (!document.body.innerText.includes("@ src/low.ts")) throw new Error("pair detail missing");
    },
    { timeout: 10_000 },
  );
  expect(document.querySelector(".detail-pane")?.textContent).toContain("is_name_purposeful");
  expect(document.querySelector(".detail-pane")?.textContent).toContain("0.08");
});
