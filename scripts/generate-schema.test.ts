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
  referencePages,
  renderReferenceMarkdown,
  renderDirectivesTable,
  renderTargetsTable,
  spliceGenerated,
} from "./generate-schema.ts";

// Unit tests for the generator's pure renderers. Freshness tests cannot catch a wrong-but-
// deterministic renderer (it regenerates the same wrong text), so the shapes are exercised here.

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

// The reference pages are data, drawn by the site's component and printed as markdown. The claims
// are held on the data, so neither view can drift from them.
describe("the reference pages", () => {
  const pages = referencePages();
  const entriesOf = (page: keyof typeof pages) => pages[page].flatMap((section) => section.entries);

  for (const page of Object.keys(pages) as (keyof typeof pages)[]) {
    test(`${page}: every entry has a unique id and a description`, () => {
      const entries = entriesOf(page);
      expect(entries.length).toBeGreaterThan(0);
      expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
      for (const entry of entries) {
        expect(entry.id, entry.id).toMatch(/^[a-z0-9_-]+$/);
        expect(entry.body.trim().length, entry.id).toBeGreaterThan(0);
      }
    });

    test(`${page}: the markdown has a real heading for every entry and section`, () => {
      const headings = renderReferenceMarkdown(pages[page])
        .split("\n")
        .filter((line) => /^#{2,4} /.test(line));
      expect(headings.length).toBe(entriesOf(page).length + pages[page].length);
    });
  }

  test("config: a name below a section's key does not repeat that key", () => {
    const handler = pages.config.find((section) => section.title === "Rule handler fields");
    expect(handler?.entries.length).toBeGreaterThan(0);
    for (const entry of handler!.entries) expect(entry.name.startsWith("handle.")).toBe(false);
  });
});

// The CLI page is the one place a person learns the commands, so it is held to three claims: a flag
// sits under the verb that takes it, every verb, noun and flag shows exactly one example the parser
// accepts, and each description is one short phrase.
describe("the CLI reference: nesting, examples and short descriptions", () => {
  const entries = referencePages().cli.flatMap((section) => section.entries);

  test("a flag is nested under its verb, and only the global flags stand alone", () => {
    let verb: string | undefined;
    const nested = new Map<string, string[]>();
    for (const entry of entries) {
      if (entry.id.startsWith("verb-")) {
        verb = entry.id.slice("verb-".length);
        nested.set(verb, []);
      } else if (entry.level === 4 && entry.id.startsWith("flag-")) {
        expect(entry.id.startsWith(`flag-${verb}-`), entry.id).toBe(true);
        nested.get(verb!)!.push(entry.name);
      } else if (entry.level === 3) {
        expect(entry.id.startsWith("flag-") && !entry.id.startsWith("flag-run-")).toBe(true);
      }
    }
    for (const name of Object.keys(VERBS)) {
      expect(nested.get(name)).toEqual(flagsOfVerb(name as never));
    }
  });

  test("every verb, noun and flag shows one example", () => {
    for (const entry of entries) expect(entry.example?.trim().length, entry.id).toBeGreaterThan(0);
  });

  // Each item has its own docs, so the page only names it. A model scored healthy descriptions of a
  // few words as low as 0.2 and defective ones as high as 0.22, so the limit is mechanical: one
  // short phrase, no clause after a colon, semicolon or dash, and no parenthesis but (repeatable).
  test("every description is one short phrase", () => {
    for (const entry of entries) {
      expect(entry.body.split(/\s+/).length, `${entry.id}: ${entry.body}`).toBeLessThanOrEqual(11);
      expect(entry.body, entry.id).not.toMatch(/[;:]| - /);
      expect(entry.body.replace("(repeatable)", ""), entry.id).not.toMatch(/[()]/);
    }
  });

  test("every example parses, and its verb takes its flags", () => {
    expect(entries.length).toBeGreaterThan(Object.keys(FLAGS).length);
    for (const command of entries.map((entry) => entry.example!)) {
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
