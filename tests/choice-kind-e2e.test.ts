import { describe, expect, jest, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "./helpers/cli.ts";
import { scratchDir } from "./helpers/dir.ts";
import { startMockJev } from "./helpers/mock-jev.ts";

// every test spawns the CLI: the per-test timeout matches the spawn ceiling
jest.setTimeout(60_000);

// A choice rule end to end: the wire carries jev's choice primitive with the option labels, the
// measurement names the selected option, and the selected option's tier decides the finding.
const CHOICE_RULE = {
  name: "is_comment_sound",
  kind: "choice",
  target: "files",
  instructions: "Which option best describes the worst comment?",
  criteria: {
    sound: "Every comment states what this code does.",
    contradicted: "A comment claims something the code does not do.",
  },
  handle: {
    choices: {
      sound: "pass",
      contradicted: { level: "error", message: "Rewrite the contradicted sentence." },
    },
  },
};

function writeFixture(): { config: string; source: string } {
  const dir = scratchDir("jint-choice-kind");
  const config = join(dir, "jint.config.json");
  const source = join(dir, "unit.ts");
  writeFileSync(config, JSON.stringify({ rules: [CHOICE_RULE] }));
  writeFileSync(source, "// returns two\nexport const one = 1;\n");
  return { config, source };
}

async function runAgainst(choice: string) {
  const jev = startMockJev({ choice });
  try {
    const { config, source } = writeFixture();
    const r = await runCli(["run", source, "--config", config, "--json"], {
      env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: jev.baseUrl },
    });
    return { r, report: JSON.parse(r.stdout), questions: jev.requests.map((q) => q.questions) };
  } finally {
    jev.stop();
  }
}

describe("choice rules", () => {
  test.concurrent("the wire carries a choice question with the option labels", async () => {
    const { questions } = await runAgainst("sound");
    // a whole-file rule's question is keyed "<rule> in <unit id>"; the request carries only it
    const [key, question] = Object.entries(questions[0]!)[0]!;
    expect(key.startsWith("is_comment_sound")).toBe(true);
    expect(question.type).toBe("choice");
    expect(Object.keys(question.criteria as object)).toEqual(["sound", "contradicted"]);
  });

  test.concurrent("a selected error option fires with its message", async () => {
    const { r, report } = await runAgainst("contradicted");
    expect(r.code).toBe(1);
    expect(report.measurements[0]).toMatchObject({ choice: "contradicted", value: 0.7 });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      rule: "is_comment_sound",
      severity: "error",
      choice: "contradicted",
      note: "Rewrite the contradicted sentence.",
    });
  });

  test.concurrent("a selected pass option measures without a finding", async () => {
    const { r, report } = await runAgainst("sound");
    expect(r.code).toBe(0);
    expect(report.measurements[0]).toMatchObject({ choice: "sound" });
    expect(report.findings).toHaveLength(0);
  });

  test.concurrent("the dry run prints the choice map and the options", async () => {
    const { config } = writeFixture();
    const r = await runCli(["run", "--dry-run", "--config", config]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      'choice map: sound pass / contradicted error · "Rewrite the contradicted sentence."',
    );
    expect(r.stdout).toContain("  contradicted  A comment claims something the code does not do.");
  });
});
