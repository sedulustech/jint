import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { ClassificationDetail } from "./ClassificationDetail";

// Acceptance: the edit-and-classify flow of the classification view. Controls are located by test id; text
// assertions read data values only.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FILE = "1700000000001-files-borderline.ts.json";
type Filed = {
  seq: number;
  rule: string;
  input: string;
  state: Record<string, string>;
  question: Record<string, unknown>;
  answer: unknown;
};
// what the server holds for the run: the classifications filed so far, listed back per rule and input
let filed: Filed[];
type Sent = {
  rule: string;
  input: string;
  instructions?: string;
  criteria?: Record<string, string>;
  code?: string;
};
const sent: Sent[] = [];
let reply: () => Promise<{ status: number; body: unknown }>;
const answers = (noul: number) => async () => ({
  status: 200,
  body: { type: "noul", noul },
});

beforeEach(() => {
  filed = [];
  sent.length = 0;
  reply = answers(0.12);
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname !== "/api/runs/run-a/classifications") return realFetch(input, init);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (init?.method !== "POST") {
      const [rule, at] = [url.searchParams.get("rule"), url.searchParams.get("input")];
      return json({ classifications: filed.filter((t) => t.rule === rule && t.input === at) });
    }
    // the server holds the original; what arrives is the address and the edit over it
    const request = JSON.parse(String(init.body)) as Sent;
    const outcome = await reply();
    if (outcome.status !== 200) return json({ error: outcome.body }, outcome.status);
    const record: Filed = {
      seq: filed.length + 1,
      rule: request.rule,
      input: request.input,
      state: { path: "src/borderline.ts", source: request.code ?? "" },
      question: {
        type: "noul",
        instructions: request.instructions ?? "",
        criteria: request.criteria ?? {},
      },
      answer: outcome.body,
    };
    sent.push(request);
    filed.push(record);
    return json({ classification: record });
  });
});

// one client per test: a client made inside tree() would be new on every rerender and refetch
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

const tree = (input: string) => (
  <QueryClientProvider client={client}>
    <ClassificationDetail
      runId="run-a"
      rule="is_name_purposeful"
      input={input}
      requestFile={FILE}
      onClose={() => {}}
    />
  </QueryClientProvider>
);

const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const field = (testid: string) => q(testid) as HTMLTextAreaElement;
const shown = () => document.querySelector("[data-answer]")?.getAttribute("data-answer");
const ready = () =>
  waitFor(
    () => {
      if (q("edit-instructions") === null) throw new Error("pane not ready");
    },
    { timeout: 2_000 },
  );
// the select is the iteration control: open it, pick the row by its position
const point = async (at: number) => {
  await page.getByTestId("classification-select").click();
  await waitFor(() => {
    if (
      document.querySelector(`[data-testid="classification-option"][data-position="${at}"]`) ===
      null
    )
      throw new Error("list not open");
  });
  document
    .querySelector<HTMLElement>(`[data-testid="classification-option"][data-position="${at}"]`)!
    .click();
};
const classify2 = async (reading: string) => {
  await page.getByTestId("classify").click();
  await waitFor(() => {
    if (shown() !== reading) throw new Error("no result yet");
  });
};
const classify = async () => {
  await page.getByTestId("classify").click();
  await waitFor(() => {
    if (shown() !== "0.12" && q("classification-error") === null) throw new Error("no result yet");
  });
};

test("the original reading shows until classify, then the new one replaces it", async () => {
  render(tree("src/borderline.ts"));
  await ready();
  const original = shown();
  expect(original).not.toBeUndefined();
  expect(original).not.toBe("0.12");
  expect(q("classification-position")).toBeNull();

  await classify();
  expect(shown()).toBe("0.12");
  expect(q("classification-position")?.dataset.position).toBe("1");
});

test("ctrl+enter classifies, from inside an editor too", async () => {
  render(tree("src/borderline.ts"));
  await ready();
  expect(shown()).not.toBe("0.12");
  await page.getByTestId("edit-instructions").fill("Is the name a verb?");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await waitFor(() => {
    if (shown() !== "0.12") throw new Error("no result yet");
  });
  expect(q("classification-position")?.dataset.position).toBe("1");
});

test("the classify row sits above the model line and keeps its layout when state changes", async () => {
  render(tree("src/borderline.ts"));
  await ready();
  const row = q("classify")!.parentElement!;
  const header = document.querySelector("section.detail-pane > header");
  expect(header?.contains(q("classify"))).toBe(false);
  const before = row.getBoundingClientRect().height;
  const resetAt = q("classification-reset")!.getBoundingClientRect().left;
  await classify();
  expect(row.getBoundingClientRect().height).toBe(before);
  expect(q("classification-reset")!.getBoundingClientRect().left).toBe(resetAt);
});

test("the new reading survives switching the view and editing the code", async () => {
  render(tree("src/borderline.ts"));
  await ready();
  await classify();
  await page.getByTestId("classification-view-request").click();
  await page.getByTestId("classification-view-code").click();
  await page.getByTestId("classification-edit-code").click();
  expect(shown()).toBe("0.12");
});

test("classify sends only the edit, never the original question or state", async () => {
  render(tree("src/borderline.ts"));
  await ready();
  await page.getByTestId("edit-instructions").fill("Is the name a verb?");
  await page.getByTestId("edit-criteria-true").fill("It is a verb.");
  await page.getByTestId("classification-edit-code").click();
  await page.getByTestId("edit-code").fill("export function run() {}");
  await classify();

  expect(sent).toHaveLength(1);
  expect(sent[0]).toEqual({
    rule: "is_name_purposeful",
    input: "src/borderline.ts",
    instructions: "Is the name a verb?",
    criteria: { true: "It is a verb." },
    code: "export function run() {}",
  });
});

test("a classification filed from outside appears while the classification detail is open", async () => {
  render(tree("src/borderline.ts"));
  await ready();
  expect(q("classification-position")).toBeNull();
  filed.push({
    seq: 1,
    rule: "is_name_purposeful",
    input: "src/borderline.ts",
    state: { path: "src/borderline.ts", source: "x" },
    question: { type: "noul", instructions: "Filed by the agent?", criteria: {} },
    answer: { type: "noul", noul: 0.44 },
  });
  await waitFor(
    () => {
      if (q("classification-position") === null) throw new Error("not polled in yet");
    },
    { timeout: 8_000 },
  );
  // the reader stays on the original: a new classification never moves the view
  expect(q("classification-position")?.dataset.position).toBe("0");
  expect(q("classification-select")?.textContent).toContain("1 of 2");
});

test("an edit after classify marks the reading stale and keeps it", async () => {
  render(tree("src/borderline.ts"));
  await ready();
  await classify();
  expect(q("classification-stale")).toBeNull();

  await page.getByTestId("edit-criteria-false").fill("Anything else.");
  expect(q("classification-stale")).not.toBeNull();
  expect(shown()).toBe("0.12");

  await classify();
  expect(q("classification-stale")).toBeNull();
  expect(sent).toHaveLength(2);
});

test("reset restores the original texts, code and reading", async () => {
  render(tree("src/borderline.ts"));
  await ready();
  const instructions = field("edit-instructions").value;
  const original = shown();
  await page.getByTestId("edit-instructions").fill("Something else?");
  await classify();

  await page.getByTestId("classification-reset").click();
  expect(field("edit-instructions").value).toBe(instructions);
  expect(shown()).toBe(original);
  expect(q("classification-position")?.dataset.position).toBe("0");
  expect(q("classification-stale")).toBeNull();
});

test("another address starts from its own original, not this one's edit", async () => {
  const view = render(tree("src/borderline.ts"));
  await ready();
  const instructions = field("edit-instructions").value;
  await page.getByTestId("edit-instructions").fill("An edit that belongs to the first address");
  await classify();

  view.rerender(tree("src/high.ts"));
  await waitFor(() => {
    if (q("classification-position") !== null)
      throw new Error("still showing the first address's classifications");
  });
  await ready();
  expect(field("edit-instructions").value).not.toBe("An edit that belongs to the first address");
  expect(shown()).not.toBe("0.12");
  expect(instructions).not.toBe("");
});

test("a failed classify names the failure and keeps every edit", async () => {
  reply = async () => ({ status: 502, body: "endpoint down" });
  render(tree("src/borderline.ts"));
  await ready();
  await page.getByTestId("edit-instructions").fill("Still here after the failure?");
  await classify();

  expect(q("classification-error")?.textContent).toContain("endpoint down");
  expect(field("edit-instructions").value).toBe("Still here after the failure?");
  expect(q("classification-position")).toBeNull();
  expect(filed).toHaveLength(0);
});

test("classify is disabled while the request is in flight", async () => {
  let release!: () => void;
  reply = () =>
    new Promise((resolve) => {
      release = () => resolve(answers(0.12)());
    });
  render(tree("src/borderline.ts"));
  await ready();
  await page.getByTestId("classify").click();
  await waitFor(() => {
    if (!(q("classify") as HTMLButtonElement).disabled) throw new Error("still enabled");
  });
  release();
  await waitFor(() => {
    if (shown() !== "0.12") throw new Error("no result yet");
  });
  expect((q("classify") as HTMLButtonElement).disabled).toBe(false);
});

test("iterations cycle: each classify is a position, and moving loads its edit and reading", async () => {
  render(tree("src/borderline.ts"));
  await ready();
  const originalReading = shown();
  const originalText = field("edit-instructions").value;

  await page.getByTestId("edit-instructions").fill("First wording?");
  reply = answers(0.2);
  await classify2("0.20");
  await page.getByTestId("edit-instructions").fill("Second wording?");
  reply = answers(0.7);
  await classify2("0.70");
  expect(q("classification-position")?.dataset.position).toBe("2");

  await point(1);
  expect(field("edit-instructions").value).toBe("First wording?");
  expect(shown()).toBe("0.20");
  expect(q("classification-stale")).toBeNull();

  await point(0);
  expect(field("edit-instructions").value).toBe(originalText);
  expect(shown()).toBe(originalReading);
  expect(q("classification-position")?.dataset.position).toBe("0");

  await point(2);
  expect(field("edit-instructions").value).toBe("Second wording?");
  expect(shown()).toBe("0.70");
});

test("classifications filed earlier are there when the detail opens again", async () => {
  filed = [
    {
      seq: 1,
      rule: "is_name_purposeful",
      input: "src/borderline.ts",
      state: { path: "src/borderline.ts", source: "x" },
      question: {
        type: "noul",
        instructions: "Filed earlier?",
        criteria: { true: "t", false: "f" },
      },
      answer: { type: "noul", noul: 0.33 },
    },
  ];
  render(tree("src/borderline.ts"));
  await ready();
  await waitFor(() => {
    if (q("classification-position") === null) throw new Error("classifications not loaded");
  });
  expect(q("classification-position")?.dataset.position).toBe("0");
  await point(1);
  expect(field("edit-instructions").value).toBe("Filed earlier?");
  expect(shown()).toBe("0.33");
});
