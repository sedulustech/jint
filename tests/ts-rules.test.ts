import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { expectContract } from "./helpers/contract.ts";
import { startMockJev } from "./helpers/mock-jev.ts";

// TS-tier end-to-end: a config-declared tsRules fragment, loaded through the jint:sdk virtual
// module, classified over the mock jev wire. Contract claims only (report shape, spans, dumps,
// fatal-vs-streamed error boundaries) — see src/core/tsrules/*.test.ts for the unit level.

const ROOT = import.meta.dir + "/..";
const CLI = ROOT + "/src/cli.ts";
const DIR = "/tmp/jint-ts-rules-e2e";

const FIXTURE = [
  "export function alpha() {",
  "  return 1;",
  "}",
  "",
  "export const beta = () => 2;",
  "",
  "",
  "// a standalone comment",
].join("\n");

const GOOD_RULE = `
import { defineConfig } from "jint:sdk";
export default defineConfig({
  rules: [{
    name: "will_ts_rule_fire",
    target: "comments",
    classify: (self, ctx) => ({
      instructions: "Judge the comment.",
      criteria: { true: "t", false: "f" },
      state: { comment: self.source, targets: ctx.targets.length, composed: { free: true } },
    }),
    handle: { warn_at: 0.5, error_at: 0.9 },
  }],
});
`;

const POLICY_RULE = `
import { defineConfig } from "jint:sdk";
export default defineConfig({
  rules: [{
    name: "will_policy_decide",
    target: "comments",
    classify: (self) => ({
      instructions: "Judge the comment.",
      criteria: { true: "t", false: "f" },
      state: { comment: self.source },
    }),
    handleClassification: (results) =>
      results.map((r) => ({
        severity: r.type === "noul" && r.noul > 0.7 ? "error" : null,
        message: "the comment drifts from the code",
        data: { rule_local: true },
      })),
  }],
});
`;

const BAD_SPEC_RULE = `
import { defineConfig } from "jint:sdk";
export default defineConfig({
  rules: [{
    name: "will_break_contract",
    target: "comments",
    classify: () => ({ instructions: "i", criteria: { true: "t" }, state: {} }),
    handle: { warn_at: 0.5, error_at: 0.9 },
  }],
});
`;

function setup(name: string, rule: string, config?: Record<string, unknown>): string {
  const dir = DIR + "/" + name;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(dir + "/fixture.ts", FIXTURE);
  writeFileSync(dir + "/rule.ts", rule);
  writeFileSync(
    dir + "/jint.config.json",
    JSON.stringify(
      config ?? {
        $schema: "../../../jint.schema.json",
        input: "fixture.ts",
        rules: [],
        tsRules: ["rule.ts"],
      },
    ),
  );
  return dir;
}

const jev = startMockJev();
const MOCK_ENV = { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: jev.baseUrl };
afterAll(() => {
  jev.stop();
  rmSync(DIR, { recursive: true, force: true });
});

async function runIn(dir: string, env: Record<string, string | undefined> = {}) {
  const proc = Bun.spawn(["bun", CLI, "--config", "jint.config.json", "--json"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...MOCK_ENV, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

describe("cli: ts rules end-to-end", () => {
  test("a config-declared TS rule classifies, fires, and binds the finding to the target span", async () => {
    const dir = setup("happy", GOOD_RULE);
    const r = await runIn(dir);
    const report = expectContract(r, { exit: 0, stdout: "json" }); // 0.8 warns (warn_at 0.5), never errors
    const measurement = report.measurements.find(
      (m: Record<string, unknown>) => m.rule === "will_ts_rule_fire",
    );
    expect(measurement).toBeDefined();
    expect(measurement?.stage).toBe("element");
    const finding = report.findings.find(
      (f: Record<string, unknown>) => f.rule === "will_ts_rule_fire",
    );
    expect(finding?.severity).toBe("warn");
    expect(finding?.location?.input).toBe("fixture.ts");
    expect(finding?.location?.span.start.line).toBe(8);
  });

  test("handleClassification decisions ride message + data on the finding", async () => {
    const dir = setup("policy", POLICY_RULE);
    const r = await runIn(dir);
    const report = expectContract(r, { exit: 1, stdout: "json" });
    const finding = report.findings.find(
      (f: Record<string, unknown>) => f.rule === "will_policy_decide",
    );
    expect(finding?.message).toBe("the comment drifts from the code");
    expect(finding?.data).toEqual({ rule_local: true });
    expect(finding?.location?.span.start.line).toBe(8);
  });

  test("wire dumps cover TS-rule calls exactly like JSON-tier calls", async () => {
    const dir = setup("dumps", GOOD_RULE);
    const dumps = DIR + "/dump-captures";
    const r = await runIn(dir, { JEV_DEBUG_REQUEST_LOCATION: dumps });
    expectContract(r, { exit: 0, stdout: "json" });
    const runDirs = readdirSync(dumps).map((d) => dumps + "/" + d);
    const files = runDirs.flatMap((d) => readdirSync(d).map((f) => d + "/" + f));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const capture = JSON.parse(readFileSync(files[0]!, "utf8"));
    // The composed state reached the wire verbatim — the observability guarantee.
    expect(capture.request.state).toEqual({
      comment: "// a standalone comment",
      targets: 1,
      composed: { free: true },
    });
    expect(capture.request.questions["will_ts_rule_fire"].instructions).toContain(
      "Judge the comment.",
    );
  });

  test("a rule file that fails at load is fatal: exit 2, the file is named", async () => {
    const dir = setup("loadfail", 'throw new Error("boom");');
    const r = await runIn(dir);
    expectContract(r, { exit: 2, stderr: [/rule\.ts/, "boom"] });
  });

  test("a mid-run contract violation streams as RULE_FAILED: per-unit, run continues", async () => {
    const dir = setup("badspec", BAD_SPEC_RULE);
    const r = await runIn(dir);
    const report = expectContract(r, { exit: 4, stdout: "json" });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.code).toBe("RULE_FAILED");
    expect(report.errors[0]?.message).toContain("will_break_contract");
    expect(report.errors[0]?.message).toContain("fixture.ts#");
  });

  test("a duplicate name across the JSON and TS tiers is fatal", async () => {
    const dir = setup("duptier", GOOD_RULE, {
      input: "fixture.ts",
      tsRules: ["rule.ts"],
      rules: ["is_name_purposeful"],
    });
    // the TS rule's name differs here; force a real cross-tier clash
    writeFileSync(dir + "/rule.ts", GOOD_RULE.replace("will_ts_rule_fire", "is_name_purposeful"));
    const r = await runIn(dir);
    expectContract(r, { exit: 2, stderr: [/is_name_purposeful/, /both tiers|across/] });
  });
});
