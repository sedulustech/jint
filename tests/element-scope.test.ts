import { describe, test, expect, afterAll } from "bun:test";
import { runCli } from "./helpers/cli.ts";
import { startMockJev } from "./helpers/mock-jev.ts";

const FIXTURE = "tests/fixtures/sample-file.ts";

// Element-scoped classification (path@L<n> / path#id): ONE walker element judged per run, so a
// fix agent tests rule x element pairs without a full-tree re-lint. Contract claims over the
// mock jev: call count, the judged source, and the finding-string round trip.
describe("cli: element-scoped runs (mocked jev)", () => {
  const jev = startMockJev();
  const MOCK_ENV = { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: jev.baseUrl };

  async function runMock(args: string[], env: Record<string, string> = {}) {
    // doors-open config: the fixture lives under tests/, which the repo config excludes -
    // these tests exercise ELEMENT SELECTION, not door semantics
    return runCli([...args, "--config", "tests/fixtures/configs/doors-open.json"], {
      env: { ...MOCK_ENV, ...env },
    });
  }
  afterAll(() => jev.stop());

  test("a line selector classifies exactly ONE element in ONE call", async () => {
    jev.requests.length = 0;
    const r = await runMock(["run", FIXTURE + "@L3"]);
    // the element's FULL rule set runs; a score-typed rule may flag under the constant mock
    expect([0, 1]).toContain(r.code);
    expect(jev.requests).toHaveLength(1);
    const source = String(jev.requests[0]!.state.source);
    expect(source).toContain("addSeconds");
    expect(source).not.toContain("formatDuration");
  });

  test("--rule narrows the scoped run to a single question (still one call)", async () => {
    jev.requests.length = 0;
    const r = await runMock(["run", FIXTURE + "@L3", "--rule", "is_greppable"]);
    expect(r.code).toBe(0);
    expect(jev.requests).toHaveLength(1);
    expect(Object.keys(jev.requests[0]!.questions)).toEqual(["is_greppable"]);
  });

  test("a pasted path#id finding string gets run-scoped guidance, not a walk", async () => {
    jev.requests.length = 0;
    const r = await runMock(["run", FIXTURE + "#f1c044af-a09f-43d8-8460-c87213766c47@L58"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("run-scoped");
    expect(r.stderr).toContain("@L58");
    expect(jev.requests).toHaveLength(0);
  });

  test("a bare file noun still judges every element (unscoped)", async () => {
    jev.requests.length = 0;
    const r = await runMock(["run", FIXTURE, "--rule", "is_greppable"]);
    expect(r.code).toBe(0);
    expect(jev.requests.length).toBeGreaterThan(1);
  });

  test("a line inside no element fails in-band with exit 2", async () => {
    const r = await runMock(["run", FIXTURE + "@L1000"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("ELEMENT_NOT_FOUND");
    expect(r.stderr).toContain("1000");
  });

  test("a RANGE selects fully-enclosed elements: one call each with --rule", async () => {
    jev.requests.length = 0;
    const r = await runMock(["run", FIXTURE + "@L2-L4", "--rule", "is_greppable"]);
    expect(r.code).toBe(0);
    expect(jev.requests).toHaveLength(1);
    expect(jev.requests[0]!.state.source).toContain("addSeconds");
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
    jev.requests.length = 0;
    const r = await runMock(["run", FIXTURE + "@L2-L4,@L6-L11", "--rule", "is_greppable"]);
    expect(r.code).toBe(0);
    expect(jev.requests).toHaveLength(2);
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

  test("an unknown --rule on a scoped run is the usual unknown-rule usage error", async () => {
    const r = await runMock(["run", FIXTURE + "@L3", "--rule", "no_such_rule"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown rule");
  });
});
