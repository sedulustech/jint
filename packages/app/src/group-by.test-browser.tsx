import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, waitFor } from "@testing-library/react";
import { expect, test, afterEach } from "vitest";
import { page } from "vitest/browser";
import { router } from "./router";

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
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// structural locators only: testids carry identity (rule, input, file); text assertions
// are for the DATA those rows display, anchored in the structural container
const q = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const all = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];

function groupRow(key: string): HTMLElement {
  const row = q('[data-testid="group-' + key + '"]');
  if (row === null) throw new Error("group row missing: " + key);
  return row;
}

function cellRows(prefix: string): HTMLElement[] {
  return all('button[data-testid^="cell-' + prefix + '"]');
}

function requestRow(file: string): HTMLElement {
  const row = q('[data-testid="request-' + file + '"]');
  if (row === null) throw new Error("request row missing: " + file);
  return row;
}

function modeButton(mode: string): HTMLElement {
  const b = q('[data-testid="mode-' + mode + '"]');
  if (b === null) throw new Error("mode button missing: " + mode);
  return b;
}

function counter(): string {
  const el = q('[data-testid="group-count"]');
  if (el === null) throw new Error("counter not found");
  const m = (el.textContent ?? "").match(/(\d+) \/ (\d+) (requests|rules|files)/);
  if (m === null) throw new Error("counter unreadable: " + el.textContent);
  return m[1] + "/" + m[2] + " " + m[3];
}

async function openRun() {
  await page.getByTestId("run-picker").click();
  await page.getByTestId("run-option-run-a").click();
  await waitFor(
    () => {
      if (q('[data-testid="group-count"]') === null) throw new Error("counter not rendered");
    },
    { timeout: 20_000 },
  );
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
    { timeout: 2_000 },
  );
}

test("request mode is the capture log: max-p column, no grouped rows, no rule chip", async () => {
  mount();
  await openRun();
  modeButton("request").click();
  await expectCounter("15/15 requests");
  expect(q('[data-testid="sort-maxProb"]')?.textContent).toContain("max-p");
  // grouped rows are gone: no group parents, no rule-carrying children
  expect(all('button[data-testid^="group-"]')).toHaveLength(0);
  expect(all('button[data-testid^="cell-"]')).toHaveLength(0);
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
  expect(q('[data-testid="sort-maxProb"]')?.textContent).toContain("max-p");
});

test("rule parents expand into cells; cell values sit on the rule's own scale", async () => {
  mount();
  await openRun();
  modeButton("rule").click();
  // default: sev desc -> an error-carrying rule parents first
  await waitFor(
    () => {
      if (!groupRow("rule:is_name_purposeful")) throw new Error("parents not rendered");
    },
    { timeout: 2_000 },
  );
  const parent = groupRow("rule:is_name_purposeful");
  expect(parent.getAttribute("aria-expanded")).toBe("false");
  parent.click();
  await waitFor(
    () => {
      if (cellRows("is_name_purposeful@").length === 0) throw new Error("children missing");
    },
    { timeout: 2_000 },
  );
  expect(parent.getAttribute("aria-expanded")).toBe("true");
  // the rule's own 0.08 reading is visible as a cell value (never max-p across questions)
  expect(
    cellRows("is_name_purposeful@")
      .map((c) => c.textContent ?? "")
      .join(" "),
  ).toContain("0.08");
  // parent click again collapses
  groupRow("rule:is_name_purposeful").click();
  await waitFor(
    () => {
      if (cellRows("is_name_purposeful@").length > 0) throw new Error("children still visible");
    },
    { timeout: 2_000 },
  );
});

test("file mode parents expand; file-level cells render as explicit (file) rows", async () => {
  mount();
  await openRun();
  modeButton("file").click();
  await expectCounter(FILES + "/" + FILES + " files");
  groupRow("file:src/multi.tsx").click();
  await waitFor(
    () => {
      if (cellRows("is_name_purposeful@src/multi.tsx").length === 0)
        throw new Error("cells missing under file parent");
    },
    { timeout: 2_000 },
  );
  // multi.tsx holds two cells (two rules), both element-tier: each renders its span label
  // ("L1-L6" from Element.span) — the uuid stays the key, the span is the display
  const children = all('button[data-testid*="@src/multi.tsx"]');
  expect(children).toHaveLength(2);
  for (const c of children) expect(c.textContent).toContain("L1-L6");
});

test("a cell click opens PairDetail addressed by (rule, input)", async () => {
  mount();
  await openRun();
  modeButton("rule").click();
  await expectCounter(RULES + "/" + RULES + " rules");
  groupRow("rule:is_name_purposeful").click();
  await waitFor(
    () => {
      if (cellRows("is_name_purposeful@src/low.ts").length === 0) throw new Error("cell missing");
    },
    { timeout: 2_000 },
  );
  cellRows("is_name_purposeful@src/low.ts")[0]!.click();
  await waitFor(
    () => {
      const d = document.body.innerText;
      if (!d.includes("is_name_purposeful @ src/low.ts")) throw new Error("pair detail not open");
    },
    { timeout: 2_000 },
  );
  // the single answer's value + its own verdict, never a sibling's
  await waitFor(
    () => {
      const pane = q(".detail-pane")?.textContent ?? "";
      // the severity word is gone from the card - the verdict color carries it; the value
      // span's title still names it structurally
      const severityTitle = q(".detail-pane [data-answer]")?.getAttribute("title") ?? "";
      if (!pane.includes("0.08") || !severityTitle.includes("error"))
        throw new Error("verdict missing, pane: " + pane.slice(0, 200));
    },
    { timeout: 2_000 },
  );
  // closing returns to the table
  const close = q("[data-testid='close-pair']");
  if (close === null) throw new Error("detail close button missing");
  close.click();
  await waitFor(
    () => {
      if (q('[data-testid="group-rule:is_name_purposeful"]') === null)
        throw new Error("table not back");
    },
    { timeout: 2_000 },
  );
  expect(q('[data-testid="group-rule:is_name_purposeful"]')).toBeTruthy();
});

test("text filter matches cells: only parents with a matching child survive", async () => {
  mount();
  await openRun();
  modeButton("rule").click();
  await expectCounter(RULES + "/" + RULES + " rules");
  await setInput("src/low.ts");
  await expectCounter("1/1 rules");
  // expanding the surviving group shows the matching child, not the whole rule
  groupRow("rule:is_name_purposeful").click();
  await waitFor(
    () => {
      const rows = cellRows("is_name_purposeful@");
      if (rows.length === 0) throw new Error("children missing");
      expect(rows).toHaveLength(1);
      // whole-unit cell: rendered as an explicit (file) row carrying its 0.08 value
      expect(rows[0]!.textContent).toContain("(file)");
      expect(rows[0]!.textContent).toContain("0.08");
    },
    { timeout: 2_000 },
  );
});

test("grouped parents order by weighted findings: 1 error > 1 warning, 4 warnings > 1 error", async () => {
  mount();
  await openRun();
  modeButton("rule").click();
  await expectCounter(RULES + "/" + RULES + " rules");
  // the findings score (err=2, warn=1) must be non-increasing across the parent rows
  await waitFor(
    () => {
      const scores = all('button[data-testid^="group-"]').map((b) => {
        const t = b.textContent ?? "";
        const err = Number(/(\d+) err/.exec(t)?.[1] ?? 0);
        const warn = Number(/(\d+) warn/.exec(t)?.[1] ?? 0);
        return err * 2 + warn;
      });
      expect(scores.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < scores.length; i++)
        expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    },
    { timeout: 2_000 },
  );
});

test("a report-panel rule click switches to rule mode, expands + scrolls to the group", async () => {
  mount();
  await openRun();
  const reportRow = q('[data-testid="report-rule-has_nothing in mind"]');
  expect(reportRow).toBeTruthy();
  reportRow!.click();
  await waitFor(
    () => {
      if (!counter().endsWith("rules")) throw new Error("not in rule mode");
    },
    { timeout: 2_000 },
  );
  // the clicked rule's group is expanded: children are FILES (rule-mode children name the
  // file, not the rule - the parent holds the rule), 3 cells all no-verdict silent-band values
  await waitFor(
    () => {
      if (cellRows("has_nothing in mind@src/greedy.ts").length < 1)
        throw new Error("group not expanded");
    },
    { timeout: 2_000 },
  );
  // 6 parents + 3 expanded children
  expect(counter()).toBe("9/" + RULES + " rules");
});

test("a report-panel rule click resets rule state: closes every group, opens only the chosen rule", async () => {
  mount();
  await openRun();
  modeButton("rule").click();
  await expectCounter(RULES + "/" + RULES + " rules");
  // open a NON-target rule group first (will_comment_drift carries 2 cells: 0.95 error, 0.45 null)
  groupRow("rule:will_comment_drift").click();
  await waitFor(
    () => {
      if (!cellRows("will_comment_drift@").some((c) => (c.textContent ?? "").includes("0.45")))
        throw new Error("will_comment_drift children missing");
    },
    { timeout: 2_000 },
  );
  // now click a DIFFERENT rule in the report panel (has_nothing in mind -> 3 cells)
  const reportRow = q('[data-testid="report-rule-has_nothing in mind"]');
  expect(reportRow).toBeTruthy();
  reportRow!.click();
  await waitFor(
    () => {
      if (cellRows("has_nothing in mind@src/greedy.ts").length < 1)
        throw new Error("chosen group not expanded");
    },
    { timeout: 2_000 },
  );
  // the previously-open group is CLOSED: only the 6 parents + 3 chosen children remain
  expect(counter()).toBe("9/" + RULES + " rules");
  // ...and its children are gone (the 0.45 cell is no longer on screen)
  expect(
    all('button[data-testid^="cell-"]').some((c) => (c.textContent ?? "").includes("0.45")),
  ).toBe(false);
});

test("request rows still drill in: a request click opens the pair detail of its first pair", async () => {
  mount();
  await openRun();
  modeButton("request").click();
  await expectCounter("15/15 requests");
  // exact path: "low.ts" substring-matches src/greedy-low.ts (earlier seq) and opens the wrong pair
  requestRow("src/low.ts").click();
  await waitFor(
    () => {
      if (!document.body.innerText.includes("@ src/low.ts")) throw new Error("pair detail missing");
    },
    { timeout: 2_000 },
  );
  expect(q(".detail-pane")?.textContent).toContain("is_name_purposeful");
  expect(q(".detail-pane")?.textContent).toContain("0.08");
});

test("generated fixture: an element cell click resolves to the element capture by uuid", async () => {
  mount();
  // the elements case (fixture-pipeline): GENERATED run, served as the nested id generated/elements
  await page.getByTestId("run-picker").click();
  await page.getByTestId("run-option-generated/elements").click();
  await waitFor(
    () => {
      if (q('[data-testid="group-count"]') === null) throw new Error("counter not rendered");
    },
    { timeout: 20_000 },
  );
  modeButton("rule").click();
  await expectCounter("12/12 rules");
  // is_name_purposeful targets definitions: expanding it reveals ONLY element cells.
  // Rule-mode children name the FILE (complex.ts / helpers.ts) with the SPAN in the
  // location cell - the span label from Element.span, never the uuid.
  groupRow("rule:is_name_purposeful").click();
  await waitFor(
    () => {
      if (cellRows("is_name_purposeful@complex.ts").length === 0)
        throw new Error("element cells not expanded");
    },
    { timeout: 2_000 },
  );
  const cells = cellRows("is_name_purposeful@complex.ts");
  // cells render the span label from Element.span ("L9" / "L12-L20"), never the uuid
  for (const c of cells) expect(c.textContent).toMatch(/L\d+(-L\d+)?/);
  cells[0]!.click();
  await waitFor(
    () => {
      const pane = q(".detail-pane")?.textContent ?? "";
      if (pane.includes("no answer for")) {
        throw new Error("pair fell back to a capture without the rule: " + pane.slice(0, 120));
      }
      if (!pane.includes("is_name_purposeful")) throw new Error("rule heading missing");
    },
    { timeout: 2_000 },
  );
  // the addressed element's OWN answer is present (deterministic stub: 0.25 in the element capture)
  let answer: string | null = null;
  await waitFor(
    () => {
      answer = q(".detail-pane [data-answer]")?.getAttribute("data-answer") ?? null;
      if (answer === null) throw new Error("answer not rendered yet");
    },
    { timeout: 2_000 },
  );
  expect(answer).toBe("0.25");
  // the pane title names the element's file + its span label (Element.span), proving the
  // element capture won - the uuid stays a key, never a display string
  const loc = all(".detail-pane span")
    .map((s) => s.textContent ?? "")
    .find((t) => /^@ (complex|helpers)\.ts · L\d+(-L\d+)?$/.test(t));
  expect(loc).toBeTruthy();
});
