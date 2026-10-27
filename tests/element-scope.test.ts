import { describe, test, expect, afterAll } from "bun:test";
import { runCli, mockDecisionsWire } from "./helpers/cli.ts";
import { startMockDecisions } from "./helpers/mock-provider.ts";

const FIXTURE = "tests/fixtures/sample-file.ts";

// Element-scoped classification (path@L<n> / path#id): ONE walker element judged per run, so a
// fix agent tests rule x element pairs without a full-tree re-lint. Contract claims over the
// mock provider: call count, the judged source, and the finding-string round trip.
describe("cli: element-scoped runs (mocked provider)", () => {
  const provider = startMockDecisions();
  const MOCK_ENV = mockDecisionsWire(provider.baseUrl);

  async function runMock(args: string[], env: Record<string, string> = {}) {
    // scopes-open config: the fixture lives under tests/, which the repo config excludes -
    // these tests exercise ELEMENT SELECTION, not scope semantics
    return runCli([...args, "--config", "tests/fixtures/configs/scopes-open.json"], {
      env: { ...MOCK_ENV, ...env },
    });
  }
  afterAll(() => provider.stop());

  test("a line selector classifies exactly ONE element in ONE call", async () => {
    provider.requests.length = 0;
    const r = await runMock(["run", FIXTURE + "@L3"]);
    // the element's FULL rule set runs; a score-typed rule may flag under the constant mock
    expect([0, 1]).toContain(r.code);
    expect(provider.requests).toHaveLength(1);
    const source = String(provider.requests[0]!.state.source);
    expect(source).toContain("addSeconds");
    expect(source).not.toContain("formatDuration");
  });

  test("--rule narrows the scoped run to a single question (still one call)", async () => {
    provider.requests.length = 0;
    const r = await runMock(["run", FIXTURE + "@L3", "--rule", "is_greppable"]);
    expect(r.code).toBe(0);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]!.questions).toHaveLength(1);
    expect(String(provider.requests[0]!.questions[0]!.instructions)).toContain("grep");
  });

  test("a pasted path#id finding string gets run-scoped guidance, not a walk", async () => {
    provider.requests.length = 0;
    const r = await runMock(["run", FIXTURE + "#f1c044af-a09f-43d8-8460-c87213766c47@L58"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("run-scoped");
    expect(r.stderr).toContain("@L58");
    expect(provider.requests).toHaveLength(0);
  });

  test("a bare file noun still judges every element (unscoped)", async () => {
    provider.requests.length = 0;
    const r = await runMock(["run", FIXTURE, "--rule", "is_greppable"]);
    expect(r.code).toBe(0);
    expect(provider.requests.length).toBeGreaterThan(1);
  });

  test("a line inside no element fails in-band with exit 2", async () => {
    const r = await runMock(["run", FIXTURE + "@L1000"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("ELEMENT_NOT_FOUND");
    expect(r.stderr).toContain("1000");
  });

  test("a RANGE selects fully-enclosed elements: one call each with --rule", async () => {
    provider.requests.length = 0;
    const r = await runMock(["run", FIXTURE + "@L2-L4", "--rule", "is_greppable"]);
    expect(r.code).toBe(0);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]!.state.source).toContain("addSeconds");
    expect(r.stderr).toContain("jint: @L2-L4 -> 1 element: L2-L4");
    // the echo block: edge-only section, stderr
    expect(r.stderr).toContain("--- " + FIXTURE + "@L2-L4 (3 lines) ---");
    expect(r.stderr).toContain(
      "2  export function addSeconds(epoch: number, seconds: number): number {",
    );
    expect(r.stderr).toContain("  ... 1 more lines ...");
    expect(r.stderr).toContain("4  }");
  });

  test("a comma list resolves each item independently: 2 elements, 2 calls", async () => {
    provider.requests.length = 0;
    const r = await runMock(["run", FIXTURE + "@L2-L4,@L6-L11", "--rule", "is_greppable"]);
    expect(r.code).toBe(0);
    expect(provider.requests).toHaveLength(2);
    expect(r.stderr).toContain("jint: @L2-L4 -> 1 element: L2-L4");
    expect(r.stderr).toContain("jint: @L6-L11 -> 1 element: L6-L11");
  });

  test("a range enclosing nothing fails with the coverage listing", async () => {
    const r = await runMock(["run", FIXTURE + "@L1000-L1002"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no element fully enclosed in L1000-L1002");
    expect(r.stderr).toContain("elements cover:");
  });

  test("an invalid span (end < start) is a usage error before any walk", async () => {
    const r = await runMock(["run", FIXTURE + "@L90-L58"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("bad line span");
  });

  test("human mode echoes WHICH element was captured on stdout BEFORE the findings", async () => {
    provider.requests.length = 0;
    const r = await runMock(["run", FIXTURE + "@L3", "--rule", "is_greppable"]);
    expect(r.code).toBe(0);
    const echoAt = r.stdout.indexOf("jint: " + FIXTURE + "@L");
    expect(echoAt).toBeGreaterThanOrEqual(0);
    const header = r.stdout.split("\n").find((l) => l.startsWith("jint: " + FIXTURE + "@L"));
    expect(header).toContain(" -> function addSeconds (L");
    // the captured text preview: the element's own first line, under the header
    const headerIdx = r.stdout.split("\n").indexOf(header!);
    expect(r.stdout.split("\n")[headerIdx + 1]).toContain("addSeconds");
  });

  test("--json keeps stdout a single JSON document with the selected object inside", async () => {
    provider.requests.length = 0;
    const r = await runMock(["run", FIXTURE + "@L3", "--rule", "is_greppable", "--json"]);
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.tool).toBe("jint");
    expect(doc.selected).toHaveLength(1);
    expect(doc.selected[0].path).toBe(FIXTURE);
    expect(doc.selected[0].kind).toBe("function");
    expect(doc.selected[0].name).toBe("addSeconds");
    expect(doc.selected[0].span.start).toBeLessThanOrEqual(3);
    expect(doc.selected[0].span.end).toBeGreaterThanOrEqual(3);
    expect(doc.selected[0].content).toContain("addSeconds");
  });

  test("an unscoped run carries no selected object (a walk has no selection)", async () => {
    provider.requests.length = 0;
    const r = await runMock(["run", FIXTURE, "--rule", "is_greppable", "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).selected).toBeUndefined();
  });

  test("an unknown --rule on a scoped run is the usual unknown-rule usage error", async () => {
    const r = await runMock(["run", FIXTURE + "@L3", "--rule", "no_such_rule"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown rule");
  });
});
