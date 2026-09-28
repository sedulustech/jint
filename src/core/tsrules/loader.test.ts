import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { loadTsConfigRules } from "./loader.ts";
import { defineConfig, validateTsRule } from "./sdk.ts";

const DIR = "tmp/tsrules-loader-test";

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
    handle: { fires_when: "true", warn_at: 0.5, error_at: 0.9 },
  }],
});
`;

describe("loadTsConfigRules", () => {
  test("loads a valid fragment through the jint:sdk virtual module", async () => {
    const path = write("valid.ts", VALID_RULE);
    const rules = await loadTsConfigRules([path]);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe("will_test_fire");
  });

  test("rejects bare specifiers BEFORE import runs (the gate)", async () => {
    const path = write("bare.ts", `import kleur from "kleur";\nexport default 1;`);
    expect(async () => await loadTsConfigRules([path])).toThrow(/kleur/);
  });

  test("rejects node:* builtins at the gate", async () => {
    const path = write("builtin.ts", `import { readFileSync } from "node:fs";\nexport default 1;`);
    expect(async () => await loadTsConfigRules([path])).toThrow(/node:fs/);
  });

  test("the gate ALLOWS relative imports, re-exports, absolute paths, and jint:*", async () => {
    // The allow matrix is contract too: legitimate rule composition must keep working, and the
    // scan must see re-export forms (export ... from) as imports.
    write("helper.ts", "export const threshold = 0.5;\nexport default 7;");
    const rules = await loadTsConfigRules([
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
          '    handle: { fires_when: "true", warn_at: 0.1, error_at: 0.9 },',
          "  }],",
          "});",
        ].join("\n"),
      ),
    ]);
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
      await loadTsConfigRules([path]);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain(path);
      expect((e as Error).message).toContain("boom");
    }
  });

  test("a non-defineConfig default export fails fatal, naming the file", async () => {
    const path = write("garbage.ts", "export default { nope: true };");
    expect(async () => await loadTsConfigRules([path])).toThrow(/defineConfig/);
  });

  test("duplicate rule names across files are fatal, naming both files", async () => {
    const a = write("dup-a.ts", VALID_RULE);
    const b = write("dup-b.ts", VALID_RULE);
    expect(async () => await loadTsConfigRules([a, b])).toThrow(
      /dup-a\.ts.*dup-b\.ts|dup-b\.ts.*dup-a\.ts/,
    );
  });
});

describe("defineConfig validation (load-time, fatal)", () => {
  test("accepts an array of fragments", () => {
    const fragment = defineConfig([{ rules: [] }, { rules: [] }]);
    expect(fragment).toHaveLength(2);
  });

  test("rejects run-level keys: fragments contribute rules ONLY", () => {
    expect(() => {
      defineConfig({ rules: [], input: "src/" } as never);
    }).toThrow(/input/);
    expect(() => {
      defineConfig({ rules: [], exclude: ["x"] } as never);
    }).toThrow(/exclude/);
  });
});

describe("validateTsRule (load-time, fatal)", () => {
  const ok = {
    name: "is_fine",
    target: "comments",
    classify: () => ({ instructions: "i", criteria: { true: "t", false: "f" }, state: {} }),
    handle: { fires_when: "true", warn_at: 0.5, error_at: 0.9 },
  };

  test("missing name", () => {
    expect(() => validateTsRule({ ...ok, name: "" }, "f.ts")).toThrow(/name/);
  });

  test("invalid target string", () => {
    expect(() => validateTsRule({ ...ok, target: "files" }, "f.ts")).toThrow(/target/);
  });

  test("missing classify", () => {
    const { classify: _c, ...rest } = ok;
    expect(() => validateTsRule(rest, "f.ts")).toThrow(/classify/);
  });

  test("exactly one policy: both is rejected", () => {
    expect(() => validateTsRule({ ...ok, handleClassification: () => [] }, "f.ts")).toThrow(
      /exactly one/,
    );
  });

  test("exactly one policy: none is rejected", () => {
    const { handle: _h, ...rest } = ok;
    expect(() => validateTsRule(rest, "f.ts")).toThrow(/exactly one/);
  });

  test("unordered handle thresholds on the defect pole", () => {
    expect(() =>
      validateTsRule(
        { ...ok, handle: { fires_when: "true", warn_at: 0.9, error_at: 0.7 } },
        "f.ts",
      ),
    ).toThrow(/warn_at < error_at/);
  });

  test("choice kind rejected as not-yet-supported", () => {
    expect(() => validateTsRule({ ...ok, kind: "choice" }, "f.ts")).toThrow(/noul/);
  });
});
