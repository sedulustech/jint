import { describe, expect, jest, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, mockDecisionsWire } from "./helpers/cli.ts";
import { scratchDir } from "./helpers/dir.ts";
import { startMockDecisions } from "./helpers/mock-provider.ts";

// every test spawns the CLI: the per-test timeout matches the spawn ceiling
jest.setTimeout(60_000);

// A choice rule end to end: the wire carries the provider's choice primitive with the option labels, the
// measurement names the selected option, and the selected option's tier decides the finding.
const CHOICE_RULE = {
  name: "is_comment_justified",
  kind: "choice",
  target: "files",
  instructions: "Which option best describes the worst comment?",
  criteria: {
    justified: "Every comment states what this code does.",
    contradicted: "A comment claims something the code does not do.",
  },
  handle: {
    choices: {
      justified: "pass",
      contradicted: { level: "error", message: "Rewrite the contradicted sentence." },
    },
  },
};

function writeFixture(rule: object = CHOICE_RULE): { config: string; source: string } {
  // concurrent tests run in the same millisecond: a random suffix keeps their fixtures apart
  const dir = scratchDir(`jint-choice-kind-${Math.random().toString(36).slice(2)}`);
  const config = join(dir, "jint.config.json");
  const source = join(dir, "unit.ts");
  writeFileSync(config, JSON.stringify({ rules: { use: [rule] } }));
  writeFileSync(source, "// returns two\nexport const one = 1;\n");
  return { config, source };
}

async function runAgainst(
  choice: string,
  rule: object = CHOICE_RULE,
  confidence?: Record<string, number>,
) {
  const provider = startMockDecisions({ choice, confidence });
  try {
    const { config, source } = writeFixture(rule);
    const r = await runCli(["run", source, "--config", config, "--json"], {
      env: mockDecisionsWire(provider.baseUrl),
    });
    return {
      r,
      report: JSON.parse(r.stdout),
      questions: provider.requests.map((q) => q.questions),
    };
  } finally {
    provider.stop();
  }
}

describe("choice rules", () => {
  test.concurrent("--json carries the provider's confidence on the measurement and the finding", async () => {
    const { report } = await runAgainst("contradicted", CHOICE_RULE, { q0: 0.22 });
    expect(report.measurements[0].confidence).toBe(0.22);
    expect(report.findings[0].confidence).toBe(0.22);
  });

  test.concurrent("--json omits confidence when the provider sent none", async () => {
    const { report } = await runAgainst("contradicted");
    expect(report.measurements[0]).not.toHaveProperty("confidence");
    expect(report.findings[0]).not.toHaveProperty("confidence");
  });

  test.concurrent("the wire carries a choice question with the option labels", async () => {
    const { questions } = await runAgainst("justified");
    // the request carries only the rule's question, named by position
    expect(questions[0]).toHaveLength(1);
    const question = questions[0]![0]!;
    expect(question).toMatchObject({ type: "choice", name: "q0" });
    expect(question.choices.map((c: { value: string }) => c.value).slice(0, 2)).toEqual([
      "justified",
      "contradicted",
    ]);
  });

  test.concurrent("a selected error option fires with its message", async () => {
    const { r, report } = await runAgainst("contradicted");
    expect(r.code).toBe(1);
    expect(report.measurements[0]).toMatchObject({ choice: "contradicted" });
    expect(report.measurements[0].value).toBeGreaterThan(0.5);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      rule: "is_comment_justified",
      severity: "error",
      choice: "contradicted",
      note: "Rewrite the contradicted sentence.",
    });
  });

  test.concurrent("a reading too close to call fires the rule's undecided tier", async () => {
    // the mock reads 0.82 for the selected option and 0.18 for the other (its none-fits mass is dropped
    // and the rest renormalized): a 0.65 lead, under 0.7
    const undecidedRule = {
      ...CHOICE_RULE,
      handle: {
        ...CHOICE_RULE.handle,
        undecided: { margin: 0.7, level: "warn", message: "Read it against the code." },
      },
    };
    const { r, report } = await runAgainst("contradicted", undecidedRule);
    expect(r.code).toBe(0);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      severity: "warn",
      undecided: true,
      note: "Read it against the code.",
    });
  });

  test.concurrent("a selected pass option measures without a finding", async () => {
    const { r, report } = await runAgainst("justified");
    expect(r.code).toBe(0);
    expect(report.measurements[0]).toMatchObject({ choice: "justified" });
    expect(report.findings).toHaveLength(0);
  });

  test.concurrent("the dry run prints the choice map and the options", async () => {
    const { config } = writeFixture();
    const r = await runCli(["run", "--dry-run", "--config", config]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      'choice map: justified pass / contradicted error · "Rewrite the contradicted sentence."',
    );
    expect(r.stdout).toContain("  contradicted  A comment claims something the code does not do.");
  });
});
