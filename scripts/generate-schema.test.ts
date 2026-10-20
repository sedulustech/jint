import { describe, expect, test } from "bun:test";
import {
  collectFixerMessages,
  renderFixerTable,
  renderHandleCell,
  renderRuleSection,
} from "./generate-schema.ts";
import type { ChoiceRuleSchema, NoulRuleSchema } from "@jint/defaults";

// Unit tests for the generator's pure renderers, fed SYNTHETIC specs. Freshness tests cannot
// catch a wrong-but-deterministic renderer (it regenerates the same wrong text), so the shapes
// are exercised here directly - including shapes the current defaults do not use yet.

const noul = (handle: NoulRuleSchema["handle"]): NoulRuleSchema => ({
  name: "synthetic_noul",
  instructions: "Is this the synthetic case?",
  criteria: { true: "yes side", false: "no side" },
  target: "files",
  handle,
});

const choice = (
  criteria: readonly string[],
  handle: ChoiceRuleSchema["handle"],
): ChoiceRuleSchema => ({
  name: "synthetic_choice",
  kind: "choice",
  instructions: "How synthetic is this?",
  criteria,
  target: "functions",
  handle,
});

describe("renderHandleCell", () => {
  test("noul: greater_than/less_than operators render as words with thresholds", () => {
    const cell = renderHandleCell(noul({ warn: { greater_than: 0.4 }, error: { less_than: 0.2 } }));
    expect(cell).toContain("warn greater than 0.4");
    expect(cell).toContain("error less than 0.2");
    expect(cell).not.toContain("[object Object]");
  });

  test("noul: a tier without a message renders thresholds only", () => {
    const cell = renderHandleCell(noul({ warn: { greater_than: 0.5 } }));
    expect(cell).toBe("warn greater than 0.5");
  });

  test("noul: a tier message is quoted after its threshold", () => {
    const cell = renderHandleCell(
      noul({
        warn: { greater_than: 0.4 },
        error: { greater_than: 0.7, message: "Delete the dead branch." },
      }),
    );
    expect(cell).toContain("error greater than 0.7");
    expect(cell).toContain('"Delete the dead branch."');
    expect(cell).not.toContain("[object Object]");
  });

  test("choice: object tiers render level and message, not [object Object]", () => {
    const cell = renderHandleCell(
      choice(["a", "b", "c"], {
        map: [
          "pass",
          { level: "warn", message: "Tighten the loop." },
          { level: "error", message: "Split this function." },
        ],
      }),
    );
    expect(cell).toContain("score map:");
    expect(cell).toContain("warn");
    expect(cell).toContain("error");
    expect(cell).toContain('"Tighten the loop."');
    expect(cell).toContain('"Split this function."');
    expect(cell).not.toContain("[object Object]");
  });

  test("choice: plain-string tiers render bare level names", () => {
    const cell = renderHandleCell(choice(["a", "b"], { map: ["pass", "error"] }));
    expect(cell).toContain("pass");
    expect(cell).toContain("error");
    expect(cell).not.toContain("[object Object]");
  });
});

describe("renderRuleSection", () => {
  test("noul section carries the rule header, table rows, and both criteria sides", () => {
    const section = renderRuleSection(
      noul({ warn: { greater_than: 0.4 }, error: { greater_than: 0.7 } }),
    );
    expect(section).toContain("## `synthetic_noul`");
    expect(section).toContain("| kind ");
    expect(section).toContain("**True.** yes side");
    expect(section).toContain("**False.** no side");
    expect(section).not.toContain("[object Object]");
  });

  test("empty-criteria edges do not crash and never print [object Object]", () => {
    const emptyNoul = renderRuleSection({
      ...noul({ warn: { greater_than: 0.5 } }),
      criteria: { true: "", false: "" },
    });
    const emptyChoice = renderRuleSection(choice([], { map: ["pass"] }));
    expect(emptyNoul).toContain("## `synthetic_noul`");
    expect(emptyChoice).toContain("## `synthetic_choice`");
    expect(emptyNoul + emptyChoice).not.toContain("[object Object]");
  });
});

describe("fixer messages", () => {
  test("collectFixerMessages picks up noul tier and choice map messages", () => {
    const messages = collectFixerMessages([
      noul({ error: { greater_than: 0.7, message: "Remove this comment." } }),
      choice(["a", "b", "c"], {
        map: ["pass", "pass", { level: "error", message: "Decompose this function." }],
      }),
    ]);
    expect(messages).toEqual([
      { rule: "synthetic_noul", severity: "error", message: "Remove this comment." },
      { rule: "synthetic_choice", severity: "error", message: "Decompose this function." },
    ]);
  });

  test("renderFixerTable quotes each message in its row", () => {
    const table = renderFixerTable([{ rule: "r", severity: "error", message: "Do the thing." }]);
    expect(table).toContain("| `r` | error | Do the thing. |");
  });
});
