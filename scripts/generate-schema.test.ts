import { describe, expect, test } from "bun:test";
import { CONFIG_SCHEMA } from "@jint/sdk";
import {
  FLAGS,
  NOUNS,
  VERBS,
  flagsOfVerb,
  parseCliArgs,
  resolveVerb,
  verbFlagProblem,
} from "../packages/cli/src/cli.ts";
import { ruleTargets } from "../packages/contract/src/handlers.ts";
import {
  collectFixerMessages,
  renderCliReference,
  renderConfigReference,
  renderEnvTable,
  renderFixerTable,
  renderDirectivesTable,
  renderHandleCell,
  renderRuleSection,
  renderTargetsTable,
  spliceGenerated,
} from "./generate-schema.ts";
import type { ChoiceRuleSchema, NoulRuleSchema, ScoreRuleSchema } from "@jint/contract";

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

const score = (
  criteria: readonly string[],
  handle: ScoreRuleSchema["handle"],
): ScoreRuleSchema => ({
  name: "synthetic_score",
  kind: "score",
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

  test("score: object tiers render level and message, not [object Object]", () => {
    const cell = renderHandleCell(
      score(["a", "b", "c"], {
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

  test("score: plain-string tiers render bare level names", () => {
    const cell = renderHandleCell(score(["a", "b"], { map: ["pass", "error"] }));
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
    const emptyScore = renderRuleSection(score([], { map: ["pass"] }));
    expect(emptyNoul).toContain("## `synthetic_noul`");
    expect(emptyScore).toContain("## `synthetic_score`");
    expect(emptyNoul + emptyScore).not.toContain("[object Object]");
  });
});

describe("fixer messages", () => {
  test("collectFixerMessages picks up noul tier and score map messages", () => {
    const messages = collectFixerMessages([
      noul({ error: { greater_than: 0.7, message: "Remove this comment." } }),
      score(["a", "b", "c"], {
        map: ["pass", "pass", { level: "error", message: "Decompose this function." }],
      }),
    ]);
    expect(messages).toEqual([
      { rule: "synthetic_noul", severity: "error", message: "Remove this comment." },
      { rule: "synthetic_score", severity: "error", message: "Decompose this function." },
    ]);
  });

  test("renderFixerTable quotes each message in its row", () => {
    const table = renderFixerTable([{ rule: "r", severity: "error", message: "Do the thing." }]);
    expect(table).toContain("| `r` | error | Do the thing. |");
  });
});

describe("renderTargetsTable", () => {
  const doc = renderTargetsTable();
  const rows = doc.split("\n").filter((line) => line.startsWith("| `"));

  test("one row per target in the vocabulary, no more, no fewer", () => {
    expect(rows).toHaveLength(ruleTargets.length);
    for (const target of ruleTargets) {
      expect(rows.some((row) => row.startsWith("| `" + target + "`"))).toBe(true);
    }
  });
});

describe("renderDirectivesTable", () => {
  test("one row per directive: name, values escaped for the table, what it does", () => {
    const doc = renderDirectivesTable([
      { name: "capture.<name>.merge", values: "contiguous | none", summary: "Runs merge." },
      { name: "attach.gap", values: "a whole number", summary: "Blank rows." },
    ]);
    expect(doc).toContain("| `capture.<name>.merge` | contiguous \\| none | Runs merge. |");
    expect(doc).toContain("| `attach.gap` | a whole number | Blank rows. |");
    expect(doc).not.toContain("declared in");
  });
});

describe("choice rules", () => {
  const choice: ChoiceRuleSchema = {
    name: "synthetic_choice",
    kind: "choice",
    instructions: "Which option fits?",
    criteria: { sound: "fine", wrong: "contradicted" },
    target: "comments",
    handle: { choices: { sound: "pass", wrong: { level: "error", message: "Rewrite it." } } },
  };

  test("the handle cell maps each option label to its level, then quotes the messages", () => {
    expect(renderHandleCell(choice)).toBe('choice map: sound → pass, wrong → error, "Rewrite it."');
  });

  test("the section names the kind and lists each option with its meaning", () => {
    const section = renderRuleSection(choice);
    expect(section).toContain("| choice ");
    expect(section).toContain("**Option `wrong`.** contradicted");
    expect(section).not.toContain("[object Object]");
  });

  test("collectFixerMessages picks up choice tier messages", () => {
    expect(collectFixerMessages([choice])).toEqual([
      { rule: "synthetic_choice", severity: "error", message: "Rewrite it." },
    ]);
  });
});

describe("spliceGenerated", () => {
  const doc =
    "# T\n\nprose\n\n<!-- generated:x - the open marker -->\n\nold\n\n<!-- /generated:x -->\n\nmore prose\n";

  test("replaces only the region between the markers", () => {
    const out = spliceGenerated(doc, "x", "| new |");
    expect(out).toContain("prose\n\n<!-- generated:x");
    expect(out).toContain("| new |");
    expect(out).not.toContain("old");
    expect(out.endsWith("<!-- /generated:x -->\n\nmore prose\n")).toBe(true);
  });

  test("a doc without the markers fails loudly", () => {
    expect(() => spliceGenerated("# T\n", "x", "b")).toThrow("generated:x");
  });
});

describe("the config schema", () => {
  // The config reference is generated from the schema, so a field without a description is a
  // blank row in the docs and no hover text in an editor.
  test("every field has a description", () => {
    type Node = {
      description?: string;
      properties?: Record<string, Node>;
      items?: Node;
      anyOf?: Node[];
    };
    const missing: string[] = [];
    const visit = (node: Node, path: string) => {
      for (const branch of node.anyOf ?? []) visit(branch, path);
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        const at = path === "" ? key : `${path}.${key}`;
        if (child.description === undefined) missing.push(at);
        visit(child, at);
      }
      if (node.items !== undefined) visit(node.items, path);
    };
    visit(CONFIG_SCHEMA as unknown as Node, "");
    expect(missing).toEqual([]);
  });
});

// The reference pages share one entry: the name in a code span first, the pills on the same line,
// the description below. A model judging this from raw HTML scored healthy pages as low as 0.41
// against 0.09 for a defective one, and missed a table-format page, so the format is held here.
describe("the reference pages: one entry format", () => {
  const entryLine =
    /^<h[34] id="[a-z0-9_-]+" class="field"><code>[^<]+<\/code><span class="pills">(<span class="pill[ a-z]*">.+?<\/span>)*<\/span><\/h[34]>$/;
  const pages = {
    config: renderConfigReference(),
    environment: renderEnvTable(),
    cli: renderCliReference(),
  };

  for (const [page, text] of Object.entries(pages)) {
    test(`${page}: every entry is a heading with its pills, then a description`, () => {
      const lines = text.split("\n");
      const entries = lines.flatMap((line, index) => (line.startsWith("<h") ? [index] : []));
      expect(entries.length).toBeGreaterThan(0);
      for (const index of entries) {
        expect(lines[index], `entry at line ${index}`).toMatch(entryLine);
        expect(lines[index + 1]).toBe("");
        expect((lines[index + 2] ?? "").trim().length).toBeGreaterThan(0);
        expect(lines[index + 2]).not.toMatch(/^[<#|]/);
      }
    });
  }

  test("config: a name below a section's key does not repeat that key", () => {
    const lines = pages.config.split("\n");
    const start = lines.indexOf("## Rule handler fields");
    expect(start).toBeGreaterThan(0);
    const names = lines
      .slice(start)
      .flatMap((line) => line.match(/class="field"><code>([^<]+)<\/code>/)?.[1] ?? []);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.startsWith("handle.")).toBe(false);
  });
});

// The CLI page is the one place a person learns the commands, so it is held to three claims: a flag
// sits under the verb that takes it, every verb, noun and flag shows exactly one example, and each
// example is a command the parser accepts.
describe("the CLI reference: nesting, examples and short descriptions", () => {
  const lines = renderCliReference().split("\n");
  const heads = lines.flatMap((line, index) => {
    const found = line.match(/^<h([34]) id="([a-z0-9_-]+)"/);
    return found === null ? [] : [{ index, level: Number(found[1]), id: found[2]! }];
  });

  test("a flag is nested under its verb, and only the global flags stand alone", () => {
    let verb: string | undefined;
    const nested = new Map<string, string[]>();
    for (const head of heads) {
      if (head.id.startsWith("verb-")) {
        verb = head.id.slice("verb-".length);
        nested.set(verb, []);
      } else if (head.level === 4 && head.id.startsWith("flag-")) {
        expect(head.id.startsWith(`flag-${verb}-`), head.id).toBe(true);
        nested.get(verb!)!.push(head.id.slice(`flag-${verb}-`.length));
      } else if (head.level === 3) {
        expect(head.id.startsWith("flag-") && !head.id.startsWith("flag-run-")).toBe(true);
      }
    }
    for (const name of Object.keys(VERBS)) {
      expect(nested.get(name)?.map((flag) => `--${flag}`)).toEqual(flagsOfVerb(name as never));
    }
  });

  test("every verb, noun and flag shows exactly one example", () => {
    for (const [at, head] of heads.entries()) {
      const end = heads[at + 1]?.index ?? lines.length;
      const fences = lines.slice(head.index, end).filter((line) => line.startsWith("```sh"));
      expect(fences.length, head.id).toBe(1);
    }
  });

  // Each item has its own docs, so the page only names it. A model scored healthy descriptions of a
  // few words as low as 0.2 and defective ones as high as 0.22, so the limit is mechanical: one
  // short phrase, no clause after a colon, semicolon or dash, and no parenthesis but (repeatable).
  test("every description is one short phrase", () => {
    for (const head of heads) {
      const description = lines[head.index + 2]!;
      expect(description.split(/\s+/).length, `${head.id}: ${description}`).toBeLessThanOrEqual(11);
      expect(description, head.id).not.toMatch(/[;:]| - /);
      expect(description.replace("(repeatable)", ""), head.id).not.toMatch(/[()]/);
    }
  });

  test("every example parses, and its verb takes its flags", () => {
    const commands = lines.flatMap((line, index) => (line === "```sh" ? [lines[index + 1]!] : []));
    expect(commands.length).toBeGreaterThan(Object.keys(FLAGS).length);
    for (const command of commands) {
      const piped = command.includes("|") ? command.split("|").pop()!.trim() : command;
      const words = (piped.match(/"[^"]*"|\S+/g) ?? []).map((word) => word.replaceAll('"', ""));
      expect(words[0]).toBe("jint");
      const parsed = parseCliArgs(words.slice(1));
      expect(parsed.outcome, command).toBe("parsed");
      if (parsed.outcome !== "parsed") continue;
      // the parser leaves a flag it does not know among the operands
      expect(
        parsed.positionals.filter((word) => word.startsWith("--")),
        command,
      ).toEqual([]);
      const verb = resolveVerb(parsed.positionals);
      if (verb === null) {
        expect(Object.keys(parsed.cliArgs).length, command).toBeGreaterThan(0);
        continue;
      }
      expect(verbFlagProblem(verb.name, parsed.cliArgs), command).toBeNull();
    }
    expect(Object.keys(NOUNS).length).toBe(2);
  });
});
