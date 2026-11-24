import { describe, expect, test } from "bun:test";
import { EMBEDDED } from "../../grammars/grammars.ts";
import { decompose, projectElement, type InventoryElement } from "../../grammars/walk.ts";
import { resolveAllCustomTargets, runCustomRules } from "./execute.ts";
import { validateCustomRule, type CustomElement, type CustomRule } from "./schema.ts";
import type { AnyState, Classifier } from "../../types.ts";

const QUESTION = { instructions: "i", criteria: { true: "t", false: "f" } };

const CLI = `# CLI

### \`show\`

#### \`--json\`

print it as JSON

\`\`\`sh
jint show --json
\`\`\`

#### \`--quiet\`

print nothing
`;

async function inventoryOf(source: string, language: string): Promise<InventoryElement[]> {
  const inv = await decompose(source, language);
  return [...inv.definitions, ...inv.comments, ...inv.imports];
}

async function statesOf(
  rule: Pick<CustomRule, "target"> & { state: NonNullable<CustomRule["state"]> },
  source: string,
  language = "markdown",
): Promise<{ states: AnyState[]; notes: string[]; errors: string[] }> {
  const states: AnyState[] = [];
  const classifier: Classifier = async (state) => {
    states.push(JSON.parse(JSON.stringify(state)) as AnyState);
    return { is_rule: { value: 0.1 } };
  };
  const full = { name: "is_rule", handle: { warn: { greater_than: 0.5 } }, ...QUESTION, ...rule };
  const valid = validateCustomRule(full, "jint.config.ts");
  const inventory = new Map([["f", await inventoryOf(source, language)]]);
  const resolved = resolveAllCustomTargets([valid], inventory, undefined, EMBEDDED);
  const { events } = await runCustomRules([valid], resolved, classifier, () => false);
  return {
    states,
    notes: events.flatMap((e) => (e.type === "note" ? [e.note] : [])),
    errors: events.flatMap((e) => (e.type === "error" ? [e.error.message] : [])),
  };
}

const example = (entry: CustomElement): string | undefined =>
  entry.getElements("markdown:code_block")[0]?.getElements("markdown:code")[0]?.source;

describe("a rule's state function", () => {
  test("composes from the parent, the name and the elements inside", async () => {
    const { states } = await statesOf(
      {
        target: "markdown:h4",
        state: (h4) => ({ command: h4.parent?.name, flag: h4.name, example: example(h4) }),
      },
      CLI,
    );
    expect(states as unknown).toEqual([
      { command: "`show`", flag: "`--json`", example: "jint show --json\n" },
      { command: "`show`", flag: "`--quiet`" },
    ]);
  });

  test("a part that was empty is one note per capture", async () => {
    const { notes } = await statesOf(
      {
        target: ["markdown:h3", "markdown:h4"],
        state: (entry) => ({ flag: entry.name, example: example(entry) }),
      },
      CLI,
    );
    expect(notes).toEqual([
      'custom rule "is_rule": example: empty in 1 of 1 h3',
      'custom rule "is_rule": example: empty in 1 of 2 h4',
    ]);
  });

  test("file.getElements() is every element, in file order", async () => {
    const { states } = await statesOf(
      {
        target: "functions",
        state: (_, { file }) => ({
          order: file.getElements().map((e) => e.capture + " " + e.name),
        }),
      },
      'import a from "a";\n\n\n// loose\n\n\nclass A {\n  m() {}\n}\nexport function f() {}\n',
      "typescript",
    );
    expect(states as unknown).toEqual([
      { order: ["import undefined", "comment undefined", "class A", "method m", "function f"] },
    ]);
  });

  test("an element lists those directly inside it, and each names it as its parent", async () => {
    await statesOf(
      {
        target: "markdown:h4",
        state: (h4) => {
          for (const child of h4.getElements()) expect(child.parent).toBe(h4);
          expect(h4.parent!.getElements()).toContain(h4);
          return {};
        },
      },
      CLI,
    ).then(({ states, errors }) => expect([states.length, errors]).toEqual([2, []]));
  });

  const PAGE = '---\ntitle: "A page"\nsidebar:\n  title: Short\n---\n\n# A\n\n## B\n\n## C\n';

  test("element is the one a target takes, found by its name among those directly inside", async () => {
    const { states } = await statesOf(
      {
        target: "markdown:h1",
        state: (h1, { file }) => ({
          title: file.getElement("markdown:frontmatter").getElement("yaml:pair", "title").value,
          sections: h1.getElements("markdown:h2").map((h2) => h2.name),
        }),
      },
      PAGE,
    );
    expect(states as unknown).toEqual([{ title: "A page", sections: ["B", "C"] }]);
  });

  test("a files target judges the file", async () => {
    const { states } = await statesOf(
      {
        target: "files",
        state: (file, ctx) => ({
          same: file === ctx.file,
          title: file.getElement("markdown:frontmatter").getElement("yaml:pair", "title").value,
          sections: file.getElements("markdown:h2").length,
        }),
      },
      PAGE,
    );
    expect(states as unknown).toEqual([{ same: true, title: "A page", sections: 2 }]);
  });

  test("a file rule follows its scope, and its finding covers the file", () => {
    const rule = validateCustomRule(
      {
        name: "is_rule",
        ...QUESTION,
        target: "files",
        include: ["docs/**"],
        state: (file: CustomElement) => ({ text: file.source }),
        handle: { warn: { greater_than: 0.5 } },
      },
      "jint.config.ts",
    );
    const paths = ["docs/a.astro", "src/b.ts"];
    const resolved = resolveAllCustomTargets(
      [rule],
      new Map(paths.map((path) => [path, []])),
      new Map(paths.map((path) => [path, "one\ntwo\n"])),
    ).get(rule);
    const targets = resolved !== undefined && "targets" in resolved ? resolved.targets : [];
    expect(targets.map((t) => [t.path, t.id, t.capture, t.span.endByte])).toEqual([
      ["docs/a.astro", "L1-L3", "file", 8],
    ]);
  });

  test.each([
    ["markdown:table", undefined, 'the h1 "A" has no markdown:table'],
    ["markdown:h2", "D", 'the h1 "A" has no markdown:h2 named "D"'],
    ["markdown:h2", undefined, 'the h1 "A" has 2 markdown:h2'],
    ["files", undefined, 'the h1 "A" holds elements, and a file is not one of them'],
    ["markdown:h22", undefined, 'does not emit "h22"'],
  ])("element %p %p throws", async (target, name, message) => {
    const { errors } = await statesOf(
      { target: "markdown:h1", state: (h1) => ({ e: h1.getElement(target, name) }) },
      PAGE,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  test("an element in a state is still valid JSON", async () => {
    const { states, errors } = await statesOf(
      { target: "markdown:h3", state: (h3) => ({ h3 }) },
      CLI,
    );
    expect(errors).toEqual([]);
    expect(states).toHaveLength(1);
  });

  test("a state that throws fails its element alone", async () => {
    const { states, errors } = await statesOf(
      {
        target: "markdown:h4",
        state: (h4) => ({ example: example(h4)!.trim() }),
      },
      CLI,
    );
    expect(states).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});

describe("an element reaches a rule and its report whole", () => {
  const DOCUMENTS: readonly (readonly [language: string, source: string])[] = [
    ["markdown", CLI],
    [
      "typescript",
      'import a from "a";\n// leads f\nexport function f() {\n  // inside\n}\nclass A {\n  m() {}\n}\nconst b = 1;\ntype T = 1;\n',
    ],
    ["python", 'class A:\n    """doc"""\n\n    def m(self):\n        """what m does"""\n'],
    ["c", "/// leads f\nint f(void) { return 1; }\n"],
  ];

  for (const [language, source] of DOCUMENTS) {
    test(language, async () => {
      const inventory = await inventoryOf(source, language);
      const seen: CustomElement[] = [];
      const rule: CustomRule = {
        name: "is_rule",
        target: (all) => all,
        ...QUESTION,
        state: (self) => {
          seen.push(self);
          return {};
        },
        handle: { warn: { greater_than: 0.5 } },
      };
      const resolved = resolveAllCustomTargets([rule], new Map([["f", inventory]]));
      const { events } = await runCustomRules(
        [rule],
        resolved,
        async () => ({ is_rule: { value: 0.1 } }),
        () => false,
      );
      const reported = events.flatMap((e) =>
        e.type === "classification" ? [e.classification.element] : [],
      );
      expect(reported).toEqual(inventory.map((e) => projectElement(e, e.parent)));
      for (const [i, walked] of inventory.entries()) {
        const { content, nodeType: _nodeType, parent, ...rest } = walked;
        expect(seen[i]).toMatchObject(rest);
        expect([seen[i]!.source, seen[i]!.parent?.label]).toEqual([content, parent]);
      }
    });
  }
});

describe("a rule's question, at load", () => {
  const load = (patch: object) => () =>
    validateCustomRule(
      { name: "is_rule", target: "functions", handle: { warn: { greater_than: 0.5 } }, ...patch },
      "jint.config.ts",
    );
  const state = () => ({});

  test("state needs its instructions and criteria", () => {
    expect(load({ state })).toThrow("state needs instructions and criteria");
    expect(load({ ...QUESTION, state })).not.toThrow();
  });

  test("state and classify together are refused", () => {
    expect(load({ ...QUESTION, state, classify: state })).toThrow("state and classify");
  });

  test("neither is refused", () => {
    expect(load(QUESTION)).toThrow("missing state(self, ctx) or classify(self, ctx)");
  });
});
