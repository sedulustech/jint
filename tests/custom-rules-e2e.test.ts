import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { runCli } from "./helpers/cli.ts";
import { expectContract } from "./helpers/contract.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";
import { startMockJev } from "./helpers/mock-jev.ts";

// custom-rule end-to-end: an INLINE callback rule in a TS config (jint.config.ts), loaded through
// the jint:sdk virtual module, classified over the mock jev wire. Contract claims only (report shape, spans, dumps,
// fatal-vs-streamed error boundaries) — see src/core/rules/custom/*.test.ts for the unit level.

const DIR = scratchDir("jint-custom-e2e");

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

const GOOD_CONFIG = `
import { defineConfig } from "jint:sdk";
export default defineConfig({
  input: "fixture.ts",
  rules: [{
    name: "will_ts_rule_fire",
    target: "comments",
    classify: (self, ctx) => ({
      instructions: "Judge the comment.",
      criteria: { true: "t", false: "f" },
      state: { comment: self.source, targets: ctx.targets.length, composed: { free: true } },
    }),
    handle: { warn: { greater_than: 0.5 }, error: { greater_than: 0.9 } },
  }],
});
`;

const POLICY_CONFIG = `
import { defineConfig } from "jint:sdk";
export default defineConfig({
  input: "fixture.ts",
  rules: [{
    name: "will_policy_decide",
    target: "comments",
    classify: (self) => ({
      instructions: "Judge the comment.",
      criteria: { true: "t", false: "f" },
      state: { comment: self.source },
    }),
    // Tiered remediation instructions: the handle branches on the raw reading (deep miss vs
    // marginal) into different instructions, and embeds the reading + resolved-ctx size in the
    // message so the rendered output itself proves the results/ctx argument wiring.
    handle: (results, ctx) =>
      results.map((r) => {
        const v = r.type === "noul" ? r.noul : 0;
        return {
          severity: v > 0.7 ? ("error" as const) : null,
          message:
            (v > 0.9
              ? "delete the comment; it pins artifacts that drift"
              : "keep the sentence, drop the file-name cross-reference") +
            " (reading " +
            v +
            " of " +
            ctx.targets.length +
            " target)",
        };
      }),
  }],
});
`;

const BAD_SPEC_CONFIG = `
import { defineConfig } from "jint:sdk";
export default defineConfig({
  input: "fixture.ts",
  rules: [{
    name: "will_break_contract",
    target: "comments",
    classify: () => ({ instructions: "i", criteria: { true: "t" }, state: {} }),
    handle: { warn: { greater_than: 0.5 }, error: { greater_than: 0.9 } },
  }],
});
`;

function setup(name: string, configSource: string): string {
  const dir = DIR + "/" + name;
  rmScratchTree(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(dir + "/fixture.ts", FIXTURE);
  writeFileSync(dir + "/jint.config.ts", configSource);
  return dir;
}

const jev = startMockJev();
const MOCK_ENV = { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: jev.baseUrl };
afterAll(() => {
  jev.stop();
  rmScratchTree(DIR);
});

async function runIn(dir: string, env: Record<string, string | undefined> = {}) {
  return runCli(["--config", "jint.config.ts", "--json"], {
    cwd: dir,
    env: { ...MOCK_ENV, ...env },
  });
}

describe("cli: custom rules end-to-end", () => {
  test("a config-declared custom rule classifies, fires, and binds the finding to the target span", async () => {
    const dir = setup("happy", GOOD_CONFIG);
    const r = await runIn(dir);
    const report = expectContract(r, { exit: 0, stdout: "json" }); // 0.8 warns (warn_at 0.5), never errors
    const measurement = report.measurements.find(
      (m: Record<string, unknown>) => m.rule === "will_ts_rule_fire",
    );
    expect(measurement).toBeDefined();
    expect(measurement?.element?.kind).toBe("comment");
    const finding = report.findings.find(
      (f: Record<string, unknown>) => f.rule === "will_ts_rule_fire",
    );
    expect(finding?.severity).toBe("warn");
    expect(finding?.location?.input).toBe(finding?.input);
    expect(finding?.location?.span.start.line).toBe(8);
  });

  test("callback handle decisions ride their message on the finding and the rendered line", async () => {
    const dir = setup("policy", POLICY_CONFIG);
    const r = await runIn(dir);
    const report = expectContract(r, { exit: 1, stdout: "json" });
    const finding = report.findings.find(
      (f: Record<string, unknown>) => f.rule === "will_policy_decide",
    );
    // The mock answers noul 0.8: severity "error" (0.8 > 0.7), and the MARGINAL band's message —
    // whose content embeds the reading (results) and the resolved target count (ctx.targets), so
    // the rendered message itself proves the callback's argument wiring.
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toBe(
      "keep the sentence, drop the file-name cross-reference (reading 0.8 of 1 target)",
    );
    expect(finding?.location?.span.start.line).toBe(8);
    // the rendered message is the report's message, byte-identical under --json (one truth)
    expect(r.stdout).toContain(
      "keep the sentence, drop the file-name cross-reference (reading 0.8 of 1 target)",
    );
    // default stdout: the message renders as an indented continuation line beneath the finding
    const raw = await runCli(["--config", "jint.config.ts"], {
      cwd: dir,
      env: { ...MOCK_ENV },
    });
    expect(raw.code).toBe(1);
    const lines = raw.stdout.trimEnd().split("\n");
    expect(lines[0]).toContain("will_policy_decide");
    expect(lines[1]).toBe(
      "    keep the sentence, drop the file-name cross-reference (reading 0.8 of 1 target)",
    );
  });

  test("wire dumps cover TS-rule calls exactly like JSON-tier calls", async () => {
    const dir = setup("dumps", GOOD_CONFIG);
    const dumps = DIR + "/dump-captures";
    const r = await runIn(dir, { JINT_DIR: dumps });
    expectContract(r, { exit: 0, stdout: "json" });
    const runDirs = readdirSync(dumps + "/runs").map((d) => dumps + "/runs/" + d);
    // report.json + manifest.json (the run's persisted metadata, not captures) are excluded
    const files = runDirs
      .flatMap((d) => readdirSync(d).map((f) => d + "/" + f))
      .filter((f) => !f.endsWith("report.json") && !f.endsWith("manifest.json"));
    // Exact contract: this fixture run makes exactly ONE classifier call (the custom rule's single
    // comment target; no JSON rules) — a manifest or second capture would break that claim.
    expect(files).toHaveLength(1);
    // The TS state is a free composition (no "source" key), so the tap kinds it "files-state".
    expect(files[0]).toMatch(/-files-state\.json$/);
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

  test("a TS config that fails at load is fatal: exit 2, the file is named", async () => {
    const dir = setup("loadfail", 'throw new Error("boom");');
    const r = await runIn(dir);
    expectContract(r, { exit: 2, stderr: [/jint\.config\.ts/, "boom"] });
  });

  test("an import-gate rejection is fatal at e2e too: exit 2, the specifier is named", async () => {
    const dir = setup("gatefail", 'import kleur from "kleur";\nexport default {};');
    const r = await runIn(dir);
    expectContract(r, { exit: 2, stderr: [/kleur/, /only "jint:\*"/] });
  });

  test("a mid-run contract violation streams as RULE_FAILED: per-unit, run continues", async () => {
    const dir = setup("badspec", BAD_SPEC_CONFIG);
    const r = await runIn(dir);
    const report = expectContract(r, { exit: 4, stdout: "json" });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.code).toBe("RULE_FAILED");
    expect(report.errors[0]?.message).toContain("will_break_contract");
    expect(report.errors[0]?.message).toContain("fixture.ts#");
  });

  test("a duplicate name across rule forms is fatal", async () => {
    const dir = setup(
      "duptier",
      [
        'import { is_name_purposeful } from "jint:defaults";',
        'import { defineConfig } from "jint:sdk";',
        "export default defineConfig({",
        '  input: "fixture.ts",',
        "  rules: [",
        "    is_name_purposeful,",
        "    {",
        '      name: "is_name_purposeful",',
        '      target: "comments",',
        '      classify: () => ({ instructions: "i", criteria: { true: "t", false: "f" }, state: {} }),',
        "      handle: { warn: { greater_than: 0.5 } },",
        "    },",
        "  ],",
        "});",
      ].join("\n"),
    );
    const r = await runIn(dir);
    expectContract(r, { exit: 2, stderr: [/is_name_purposeful/, /duplicate rule name/] });
  });
});
