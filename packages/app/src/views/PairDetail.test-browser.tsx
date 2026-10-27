import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { PairDetail } from "./PairDetail";

afterEach(cleanup);

// run-a: borderline.ts carries a wire request (the translated body); high.ts predates wire capture
const WITH_WIRE = "1700000000001-files-borderline.ts.json";
const WITHOUT_WIRE = "1700000000002-files-high.ts.json";
// a decisions-form recording: the real exchange, served as the same view model
const DECISIONS_FORM = "1700000000017-files-decisions.ts.json";

const copied: string[] = [];
beforeEach(() => {
  copied.length = 0;
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(async (text) => {
    copied.push(text);
  });
});

function open(file: string, input: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PairDetail
        runId="run-a"
        rule="is_name_purposeful"
        input={input}
        requestFile={file}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const ready = () =>
  waitFor(
    () => {
      if (q('[data-testid="pair-view-request"]') === null) throw new Error("pane not ready");
    },
    { timeout: 2_000 },
  );

test("the pair view defaults to the code and toggles to the raw request and back", async () => {
  open(WITH_WIRE, "src/borderline.ts");
  await ready();
  expect(q('[data-testid="pair-view-code"]')!.getAttribute("aria-pressed")).toBe("true");
  expect(q('[data-testid="pair-request"]')).toBeNull();
  expect(q('[data-testid="pair-view"] pre')?.textContent).toContain("export function alpha");

  await page.getByTestId("pair-view-request").click();
  await page.getByTestId("pair-request-raw").click();
  const panel = q('[data-testid="pair-view"]')!;
  expect(q('[data-testid="pair-view-request"]')!.getAttribute("aria-pressed")).toBe("true");
  expect(q('[data-testid="pair-view-request"]')!.getAttribute("aria-controls")).toBe(panel.id);
  const shown = q('[data-testid="pair-request"] pre')!;
  const body = JSON.parse(shown.textContent!);
  expect(body.questions[0].type).toBe("predicate");
  expect(JSON.parse(body.input).path).toBe("src/borderline.ts");
  // highlighted, not plain text
  expect(shown.querySelector(".hljs-attr")).not.toBeNull();
  expect(q('[data-testid="pair-request-note"]')).toBeNull();

  await page.getByTestId("pair-view-code").click();
  expect(q('[data-testid="pair-request"]')).toBeNull();
  expect(q('[data-testid="pair-view"] pre')?.textContent).toContain("export function alpha");
});

test("the copy button copies what the active view renders", async () => {
  open(WITH_WIRE, "src/borderline.ts");
  await ready();
  await page.getByRole("button", { name: "copy code" }).click();
  await waitFor(() => expect(copied).toHaveLength(1));
  expect(copied[0]).toContain("export function alpha");

  await page.getByTestId("pair-view-request").click();
  await page.getByRole("button", { name: "copy request" }).click();
  await waitFor(() => expect(copied).toHaveLength(2));
  expect(JSON.parse(copied[1]!).model).toBe("jev-1.13.0");
});

test("the request reads parsed by default: input expanded, strings across real lines", async () => {
  open(WITH_WIRE, "src/borderline.ts");
  await ready();
  await page.getByTestId("pair-view-request").click();
  expect(q('[data-testid="pair-request-parsed"]')!.getAttribute("aria-pressed")).toBe("true");
  expect(q('[data-testid="pair-request-parsed-panel"]')).not.toBeNull();
  expect(q('[data-testid="pair-request-parsed-note"]')).not.toBeNull();
  const panel = q('[data-testid="pair-view"]')!;
  for (const m of ["parsed", "raw"]) {
    expect(q(`[data-testid="pair-request-${m}"]`)!.getAttribute("aria-controls")).toBe(panel.id);
  }
  const parsed = q('[data-testid="pair-request-parsed-panel"]')!;
  // input is a nested object: path and content are separate entries
  expect(parsed.textContent).toContain('"path": "src/borderline.ts"');
  expect(parsed.textContent).not.toContain('\\"path\\"');
  expect(parsed.querySelector(".hljs-attr")).not.toBeNull();
  const texts = [...document.querySelectorAll<HTMLElement>('[data-testid="pair-request-text"]')];
  const content = texts.find((t) => t.textContent!.includes("export function alpha"))!;
  expect(content.textContent!.split("\n").length).toBeGreaterThan(2);
  expect(content.textContent).not.toContain("\\n");
  // each question's instructions read across lines too
  expect(texts.some((t) => t.textContent!.includes("Judge is_name_purposeful."))).toBe(true);
  expect(texts.every((t) => !t.textContent!.includes("\\n"))).toBe(true);
});

test("raw shows the escaped string; the copy button gives the exact body in both forms", async () => {
  open(WITH_WIRE, "src/borderline.ts");
  await ready();
  await page.getByTestId("pair-view-request").click();
  await page.getByRole("button", { name: "copy request" }).click();
  await page.getByTestId("pair-request-raw").click();
  expect(q('[data-testid="pair-request-raw"]')!.getAttribute("aria-pressed")).toBe("true");
  expect(q('[data-testid="pair-request-parsed-panel"]')).toBeNull();
  expect(q('[data-testid="pair-request-parsed-note"]')).toBeNull();
  expect(q('[data-testid="pair-request"] pre')!.textContent).toContain("\\n");
  await page.getByRole("button", { name: "copy request" }).click();
  await waitFor(() => expect(copied).toHaveLength(2));
  expect(copied[0]).toBe(copied[1]);
  expect(copied[1]).toBe(q('[data-testid="pair-request"] pre')!.textContent);
  expect(typeof JSON.parse(copied[1]!).input).toBe("string");
});

test("a recording without a wire shows jint's request shape and says so", async () => {
  open(WITHOUT_WIRE, "src/high.ts");
  await ready();
  await page.getByTestId("pair-view-request").click();
  expect(q('[data-testid="pair-request"]')!.getAttribute("data-wire")).toBe("false");
  expect(q('[data-testid="pair-request-note"]')).not.toBeNull();
  // parsed (default): the recorded shape reads across lines; raw: the pretty JSON; same copy
  expect(q('[data-testid="pair-request-parsed-panel"]')!.textContent).toContain(
    '"path": "src/high.ts"',
  );
  await page.getByRole("button", { name: "copy request" }).click();
  await page.getByTestId("pair-request-raw").click();
  const body = JSON.parse(q('[data-testid="pair-request"] pre')!.textContent!);
  expect(body.state.path).toBe("src/high.ts");
  await page.getByRole("button", { name: "copy request" }).click();
  await waitFor(() => expect(copied).toHaveLength(2));
  expect(copied[0]).toBe(copied[1]);
  expect(JSON.parse(copied[0]!)).toEqual(body);
});

test("a decisions-form recording shows its state, and its real request body", async () => {
  open(DECISIONS_FORM, "src/decisions.ts");
  await ready();
  // the code is the input_json part's state
  expect(q('[data-testid="pair-view"] pre')?.textContent).toContain("export function alpha");
  await page.getByTestId("pair-view-request").click();
  await page.getByTestId("pair-request-raw").click();
  expect(q('[data-testid="pair-request"]')!.getAttribute("data-wire")).toBe("true");
  expect(q('[data-testid="pair-request-note"]')).toBeNull();
  const body = JSON.parse(q('[data-testid="pair-request"] pre')!.textContent!);
  expect(body.input[0].content[0].type).toBe("input_json");
  expect(body.questions[0]).toMatchObject({ type: "predicate", name: "q0" });
});
