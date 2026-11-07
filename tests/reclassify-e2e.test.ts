import { describe, expect, jest, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, mockDecisionsWire } from "./helpers/cli.ts";
import { scratchDir } from "./helpers/dir.ts";
import { startMockDecisions } from "./helpers/mock-provider.ts";

jest.setTimeout(60_000);

// reclassify end to end: a real run records a classification, then the verb asks that rule at that input again through the
// SDK's one reclassify and files it under the same run as the agent's #N.
const RULE = {
  name: "is_comment_justified",
  kind: "choice",
  target: "files",
  instructions: "Which option best describes the worst comment?",
  criteria: { justified: "Every comment states what the code does.", contradicted: "A lie." },
  handle: { choices: { justified: "pass", contradicted: "error" } },
};

/** A scratch store holding one recorded run of the rule, answered `contradicted`. */
async function recordedRun() {
  const dir = scratchDir(`jint-reclassify-${Math.random().toString(36).slice(2)}`);
  const config = join(dir, "jint.config.json");
  const source = join(dir, "unit.ts");
  writeFileSync(config, JSON.stringify({ rules: { use: [RULE] } }));
  writeFileSync(source, "// returns two\nexport const one = 1;\n");
  const store = join(dir, "runs");
  const provider = startMockDecisions({ choice: "contradicted" });
  try {
    const run = await runCli(["run", source, "--config", config, "--json"], {
      env: { ...mockDecisionsWire(provider.baseUrl), JINT_RUNS_DIR: store },
    });
    const report = JSON.parse(run.stdout);
    return {
      store,
      runId: readdirSync(store)[0]!,
      input: report.classifications[0].input as string,
    };
  } finally {
    provider.stop();
  }
}

describe("jint reclassify", () => {
  test("files the edit under the run as the agent's next #N, and reads it back", async () => {
    const { store, runId, input } = await recordedRun();
    const provider = startMockDecisions({ choice: "justified" });
    try {
      const env = { ...mockDecisionsWire(provider.baseUrl), JINT_RUNS_DIR: store };
      const edit = JSON.stringify({ instructions: "Which option fits best?" });
      const r = await runCli(["reclassify", runId, input, "--rule", RULE.name, "--json", "-"], {
        env,
        stdin: edit,
      });
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      const filed = JSON.parse(r.stdout);
      expect(filed).toMatchObject({ n: 1, by: "agent", rule: RULE.name, input });
      expect(filed.answer.choice).toBe("justified");
      expect(filed.question.instructions).toBe("Which option fits best?");
      // the criteria were not sent: they are the run's own
      expect(Object.keys(filed.question.criteria)).toEqual(["justified", "contradicted"]);
      expect(readdirSync(join(store, runId, "classifications"))).toEqual(["0001.json"]);

      // no edit: the original question again, filed as #2, in the human form
      const again = await runCli(["reclassify", runId, input, "--rule", RULE.name], { env });
      expect(again.code).toBe(0);
      expect(again.stdout).toContain("#2 justified");
      expect(
        JSON.parse(readFileSync(join(store, runId, "classifications", "0002.json"), "utf8"))
          .question.instructions,
      ).toBe(RULE.instructions);
    } finally {
      provider.stop();
    }
  });

  test("usage errors exit 2 and file nothing", async () => {
    const { store, runId, input } = await recordedRun();
    const env = { ...mockDecisionsWire("http://127.0.0.1:9"), JINT_RUNS_DIR: store };
    const noRule = await runCli(["reclassify", runId, input], { env });
    expect(noRule.code).toBe(2);
    expect(noRule.stderr).toContain("jint reclassify takes");

    const unknownAddress = await runCli(["reclassify", runId, "nope.ts", "--rule", RULE.name], {
      env,
    });
    expect(unknownAddress.code).toBe(2);
    expect(unknownAddress.stderr).toContain("no recorded request");

    const notJson = await runCli(["reclassify", runId, input, "--rule", RULE.name, "-"], {
      env,
      stdin: "not json",
    });
    expect(notJson.code).toBe(2);
    expect(notJson.stderr).toContain("not JSON");

    const badCriteria = await runCli(["reclassify", runId, input, "--rule", RULE.name, "-"], {
      env,
      stdin: JSON.stringify({ criteria: { maybe: "?" } }),
    });
    expect(badCriteria.code).toBe(2);
    expect(badCriteria.stderr).toContain("no such criteria: maybe");

    const badFlag = await runCli(
      ["reclassify", runId, input, "--rule", RULE.name, "--disable", "x"],
      {
        env,
      },
    );
    expect(badFlag.code).toBe(2);
    expect(badFlag.stderr).toContain("--disable does not apply to reclassify");
    expect(readdirSync(join(store, runId)).includes("classifications")).toBe(false);
  });
});
