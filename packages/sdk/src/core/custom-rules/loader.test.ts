import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { defaultRuleSpecs } from "@jint/defaults";
import { loadCustomRules, registerCustomRuleLoader } from "./loader.ts";
import { defineConfig, validateCustomRule } from "./sdk.ts";

const DIR = "tmp/custom-rules-loader-test";

function write(name: string, code: string): string {
  mkdirSync(DIR, { recursive: true });
  const path = DIR + "/" + name;
  writeFileSync(path, code);
  return path;
}

afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const VALID_RULE = `
import { defineConfig } from "jint:sdk";
export default defineConfig({
  rules: [{
    name: "will_test_fire",
    target: "comments",
    classify: (self, ctx) => ({
      instructions: "i",
      criteria: { true: "t", false: "f" },
      state: { source: self.source, targets: ctx.targets.length },
    }),
    handle: { warn: { greater_than: 0.5 }, error: { greater_than: 0.9 } },
  }],
});
`;

describe("loadCustomRules", () => {
  // the provider is the entry point's decision; registered before any jint:defaults import runs
  registerCustomRuleLoader({ defaults: defaultRuleSpecs });
  test("loads a valid fragment through the jint:sdk virtual module", async () => {
    const path = write("valid.ts", VALID_RULE);
    const rules = (await loadCustomRules([path])).custom;
    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe("will_test_fire");
  });

  test("rejects bare specifiers BEFORE import runs (the gate)", async () => {
    const path = write("bare.ts", `import kleur from "kleur";\nexport default 1;`);
    expect(async () => await loadCustomRules([path])).toThrow(/kleur/);
  });

  test("rejects node:* builtins at the gate", async () => {
    const path = write("builtin.ts", `import { readFileSync } from "node:fs";\nexport default 1;`);
    expect(async () => await loadCustomRules([path])).toThrow(/node:fs/);
  });

  test("multi-file composition: rules from every file load, order and identity preserved", async () => {
    // the composition story (design config-composition/03): a file may import another file's
    // fragment and extend it - jint only sees the final rules array, last-wins per name.
    write(
      "shared.ts",
      'import { defineConfig } from "jint:sdk";\n' +
        "export const sharedRule = {\n" +
        '  name: "shared_rule",\n' +
        '  target: "comments" as const,\n' +
        '  classify: () => ({ instructions: "i", criteria: { true: "t", false: "f" }, state: {} }),\n' +
        "  handle: { warn: { greater_than: 0.5 } },\n" +
        "};\n" +
        "export const base = defineConfig({ rules: [sharedRule] });\n",
    );
    const a = write(
      "a.ts",
      'import { defineConfig } from "jint:sdk";\n' +
        'import { sharedRule } from "./shared.ts";\n' +
        "export default defineConfig({\n" +
        "  rules: [\n" +
        "    sharedRule,\n" +
        '    { name: "a_rule", target: "functions", classify: sharedRule.classify, handle: sharedRule.handle },\n' +
        "  ],\n" +
        "});\n",
    );
    const b = write(
      "b.ts",
      'import { sharedRule } from "./shared.ts";\n' +
        'import { defineConfig } from "jint:sdk";\n' +
        "export default defineConfig({\n" +
        "  rules: [\n" +
        "    // same helper, distinct name - a distinct rule built from shared parts\n" +
        '    { name: "b_rule", target: "comments", classify: sharedRule.classify, handle: { warn: { greater_than: 0.4 } } },\n' +
        "  ],\n" +
        "});\n",
    );
    const rules = (await loadCustomRules([a, b])).custom;
    // order follows the declared file order, then in-file order; identity is the name
    expect(rules.map((r) => r.name)).toEqual(["shared_rule", "a_rule", "b_rule"]);
    // the cross-file import actually composed: every loaded rule carries a working classify
    expect(rules.every((r) => typeof r.classify === "function")).toBe(true);
  });

  test("a declarative spec import loads through the declarative lane (no classify needed)", async () => {
    const path = write(
      "declarative.ts",
      'import { defaultRuleSpecs } from "jint:defaults";\n' +
        'import { defineConfig } from "jint:sdk";\n' +
        'import { is_greppable } from "jint:defaults";\n' +
        'export default defineConfig({ rules: [{ ...is_greppable, exclude: ["**/*.test.ts"] }] });',
    );
    const loaded = await loadCustomRules([path]);
    expect(loaded.custom).toHaveLength(0);
    expect(loaded.declarative).toHaveLength(1);
    const entry = loaded.declarative[0]?.entry as { name: string; exclude: string[] };
    expect(entry.name).toBe("is_greppable");
    expect(entry.exclude).toEqual(["**/*.test.ts"]);
  });

  test("fragment scoping is the default; a rule declaring its own replaces it wholesale", async () => {
    const path = write(
      "scoped-fragment.ts",
      [
        'import { defineConfig } from "jint:sdk";',
        'import { is_greppable } from "jint:defaults";',
        "export default defineConfig({",
        '  exclude: ["**/*.test.ts"],',
        '  rules: [is_greppable, { ...is_greppable, name: "is_greppable_src", include: ["src/**"] }],',
        "});",
      ].join("\n"),
    );
    const loaded = await loadCustomRules([path]);
    expect(loaded.declarative).toHaveLength(2);
    const inherited = loaded.declarative[0]?.entry as { exclude?: string[] };
    const own = loaded.declarative[1]?.entry as { include?: string[]; exclude?: string[] };
    expect(inherited.exclude).toEqual(["**/*.test.ts"]);
    // rule-level replaces wholesale: no fragment field leaks into a rule that declares its own
    expect(own.include).toEqual(["src/**"]);
    expect(own.exclude).toBeUndefined();
  });

  test("the gate ALLOWS the first-party defaults package (install-time versioned)", async () => {
    // the import must resolve and execute; whether a declarative spec may sit in a fragment's
    // rules is a separate question (config-composition/03 follow-up) - this pins the gate only
    const path = write(
      "defaults-import.ts",
      'import { defaultRuleSpecs } from "@jint/defaults";\n' +
        'import { defineConfig } from "jint:sdk";\n' +
        "const count = Object.keys(defaultRuleSpecs).length;\n" +
        "export default defineConfig({ rules: [], include: count > 0 ? undefined : [] });",
    );
    const rules = (await loadCustomRules([path])).custom;
    expect(rules).toHaveLength(0);
  });

  test("the gate ALLOWS relative imports, re-exports, absolute paths, and jint:*", async () => {
    // The allow matrix is contract too: legitimate rule composition must keep working, and the
    // scan must see re-export forms (export ... from) as imports.
    write("helper.ts", "export const threshold = 0.5;\nexport default 7;");
    const rules = await loadCustomRules([
      write(
        "composed.ts",
        [
          'import { defineConfig } from "jint:sdk";',
          'import { threshold } from "./helper.ts";',
          'import abs from "' + process.cwd() + "/" + DIR + "/helper.ts" + '";',
          'import { default as reexported } from "./helper.ts";',
          'export { threshold as passthrough } from "./helper.ts";',
          "export default defineConfig({",
          "  rules: [{",
          '    name: "composed_rule",',
          '    target: "comments",',
          "    classify: (self) => ({",
          '      instructions: "i",',
          '      criteria: { true: "t", false: "f" },',
          "      state: { source: self.source, from: threshold + abs + reexported },",
          "    }),",
          "    handle: { warn: { greater_than: 0.1 }, error: { greater_than: 0.9 } },",
          "  }],",
          "});",
        ].join("\n"),
      ),
    ]).then((r) => r.custom);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe("composed_rule");
    // The imported values actually crossed the gate: run classify and read the composed state.
    const spec = rules[0]!.classify(
      {
        id: "c0",
        path: "f.ts",
        role: "comment",
        source: "// x",
        span: {
          start: { line: 1, column: 0 },
          end: { line: 1, column: 4 },
          startByte: 0,
          endByte: 4,
        },
        parent: null,
      },
      { targets: [rules[0] as never] },
    );
    expect((spec.state as Record<string, unknown>).from).toBe(0.5 + 7 + 7);
  });

  test("a thrown module fails fatal, naming the file", async () => {
    const path = write("throwing.ts", 'throw new Error("boom");');
    try {
      await loadCustomRules([path]);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain(path);
      expect((e as Error).message).toContain("boom");
    }
  });

  test("a non-defineConfig default export fails fatal, naming the file", async () => {
    const path = write("garbage.ts", "export default { nope: true };");
    expect(async () => await loadCustomRules([path])).toThrow(/defineConfig/);
  });

  test("duplicate rule names across files are fatal, naming both files", async () => {
    const a = write("dup-a.ts", VALID_RULE);
    const b = write("dup-b.ts", VALID_RULE);
    expect(async () => await loadCustomRules([a, b])).toThrow(
      /dup-a\.ts.*dup-b\.ts|dup-b\.ts.*dup-a\.ts/,
    );
  });
});

describe("defineConfig validation (load-time, fatal)", () => {
  test("accepts an array of fragments", () => {
    const fragment = defineConfig([{ rules: [] }, { rules: [] }]);
    expect(fragment).toHaveLength(2);
  });

  test("rejects run-level keys other than the fragment's own scoping (design 02)", () => {
    expect(() => {
      defineConfig({ rules: [], input: "src/" } as never);
    }).toThrow(/input/);
    // include/exclude are fragment-level scoping, allowed since config-composition/02
    expect(defineConfig({ rules: [], exclude: ["x"] })).toEqual({
      rules: [],
      exclude: ["x"],
    });
  });
});

describe("validateCustomRule (load-time, fatal)", () => {
  const ok = {
    name: "is_fine",
    target: "comments",
    classify: () => ({ instructions: "i", criteria: { true: "t", false: "f" }, state: {} }),
    handle: { warn: { greater_than: 0.5 }, error: { greater_than: 0.9 } },
  };

  test("missing name", () => {
    expect(() => validateCustomRule({ ...ok, name: "" }, "f.ts")).toThrow(/name/);
  });

  test("invalid target string", () => {
    expect(() => validateCustomRule({ ...ok, target: "files" }, "f.ts")).toThrow(/target/);
  });

  test("missing classify", () => {
    const { classify: _c, ...rest } = ok;
    expect(() => validateCustomRule(rest, "f.ts")).toThrow(/classify/);
  });

  test("exactly one policy: both is rejected", () => {
    expect(() => validateCustomRule({ ...ok, handleClassification: () => [] }, "f.ts")).toThrow(
      /exactly one/,
    );
  });

  test("exactly one policy: none is rejected", () => {
    const { handle: _h, ...rest } = ok;
    expect(() => validateCustomRule(rest, "f.ts")).toThrow(/exactly one/);
  });

  test("every shared handler invariant rejects with the field named (parity with the JSON tier)", () => {
    const cases: readonly unknown[] = [
      { warn: { greater_than: 1.5 } }, // warn_at outside (0, 1)
      { warn: { greater_than: 0.5 }, error: { greater_than: 0.0 } }, // error_at outside (0, 1)
      { warn: { greater_than: 0.9 }, error: { greater_than: 0.7 } }, // unordered on the defect pole
      { warn: { greater_than: 0.3 }, silent_band: [0.6, 0.4] }, // band unordered
      { warn: { greater_than: 0.3 }, silent_band: [0, 1] }, // band covers the scale
      { warn: { greater_than: 0.3 }, silent_band: [0.2, 0.4] }, // band contains warn_at
      { warn: { greater_than: 0.3 }, error: { greater_than: 0.7 }, silent_band: [0.4, 0.75] }, // contains error_at
      { warn: { greater_than: 0.5 }, map: ["pass", "warn"] }, // score handler on a noul rule
    ];
    for (const handle of cases) {
      expect(() => validateCustomRule({ ...ok, handle }, "f.ts")).toThrow(/"is_fine": handle/);
    }
  });

  test("choice kind rejected as not-yet-supported", () => {
    expect(() => validateCustomRule({ ...ok, kind: "choice" }, "f.ts")).toThrow(/noul/);
  });
});
