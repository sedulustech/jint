import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { domains } from "@jint/rules";
import { loadTsConfig } from "../../../config/load.ts";
import { registerCustomRuleLoader } from "./loader.ts";
import { defineConfig, validateCustomRule } from "./schema.ts";

const DIR = "tmp/ts-config-loader-test";

function write(name: string, code: string): string {
  mkdirSync(DIR, { recursive: true });
  const path = DIR + "/" + name;
  writeFileSync(path, code);
  return path;
}

afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const INLINE_RULE_CONFIG = [
  'import { is_greppable } from "jint:rules/naming";\n' +
    'import { defineConfig } from "jint:sdk";\n' +
    "export default defineConfig({\n" +
    "  rules: [\n" +
    '    { ...is_greppable, exclude: ["**/*.test.ts"] },\n' +
    "    {\n" +
    '      name: "will_test_fire",\n' +
    '      target: "comments",\n' +
    "      classify: (self, ctx) => ({\n" +
    '        instructions: "i",\n' +
    '        criteria: { true: "t", false: "f" },\n' +
    "        state: { source: self.source, targets: ctx.targets.length },\n" +
    "      }),\n" +
    "      handle: { warn: { greater_than: 0.5 }, error: { greater_than: 0.9 } },\n" +
    "    },\n" +
    "  ],\n" +
    "});\n",
].join("");

describe("loadTsConfig (the TS config tier)", () => {
  // the provider is the entry point's decision; registered before any jint:rules import runs
  registerCustomRuleLoader({ domains });

  test("a TS config with an INLINE callback rule loads end to end: declarative compiles, callback validates", async () => {
    const path = write("inline-rule.config.ts", INLINE_RULE_CONFIG);
    const config = await loadTsConfig(path, { catalog: undefined as never });
    // the declarative entry (jint:rules spread-override) compiled through the config seam
    const greppable = config.rules.find((r) => r.name === "is_greppable");
    expect(greppable).toBeDefined();
    expect(greppable?.exclude).toEqual(["**/*.test.ts"]);
    // the inline callback rule validated and carried for the custom engine
    expect(config.customRules).toHaveLength(1);
    expect(config.customRules![0]!.name).toBe("will_test_fire");
    expect(typeof config.customRules![0]!.classify).toBe("function");
  });

  test("the gate rejects bare specifiers BEFORE import runs", async () => {
    const path = write("bare.config.ts", `import kleur from "kleur";\nexport default {};`);
    expect(async () => await loadTsConfig(path)).toThrow(/kleur/);
  });

  test("the gate rejects node:* builtins", async () => {
    const path = write(
      "builtin.config.ts",
      `import { readFileSync } from "node:fs";\nexport default {};`,
    );
    expect(async () => await loadTsConfig(path)).toThrow(/node:fs/);
  });

  test("cross-file composition: relative imports compose, in array order", async () => {
    write(
      "shared.ts",
      "export const sharedRule = {\n" +
        '  name: "shared_rule",\n' +
        '  target: "comments" as const,\n' +
        '  classify: () => ({ instructions: "i", criteria: { true: "t", false: "f" }, state: {} }),\n' +
        "  handle: { warn: { greater_than: 0.5 } },\n" +
        "};\n",
    );
    const path = write(
      "composed.config.ts",
      'import { defineConfig } from "jint:sdk";\n' +
        'import { sharedRule } from "./shared.ts";\n' +
        "export default defineConfig({\n" +
        "  rules: [\n" +
        "    sharedRule,\n" +
        '    { name: "a_rule", target: "functions", classify: sharedRule.classify, handle: sharedRule.handle },\n' +
        "  ],\n" +
        "});\n",
    );
    const config = await loadTsConfig(path);
    // order follows the array, identity is the name; the cross-file import actually composed
    expect(config.customRules!.map((r) => r.name)).toEqual(["shared_rule", "a_rule"]);
    expect(config.customRules!.every((r) => typeof r.classify === "function")).toBe(true);
  });

  test("jint:rules/<domain> serves the domain plus each rule under its own name", async () => {
    const path = write(
      "virtual.config.ts",
      'import { rules, is_greppable } from "jint:rules/naming";\n' +
        'import { defineConfig } from "jint:sdk";\n' +
        'export default defineConfig({ rules: [...rules, { ...is_greppable, include: ["src/**"], override: true }] });\n',
    );
    const config = await loadTsConfig(path);
    // the whole domain composed, and the explicit override replaced the rule it names
    const greppable = config.rules.find((r) => r.name === "is_greppable");
    expect(greppable?.include).toEqual(["src/**"]);
    expect(config.rules.map((r) => r.name).filter((n) => n === "is_greppable")).toHaveLength(1);
    expect(config.rules.map((r) => r.name)).toContain("has_filename_mismatch");
  });

  test("a rule imported twice without override is an error naming both entries", async () => {
    const path = write(
      "twice.config.ts",
      'import { rules, is_greppable } from "jint:rules/naming";\n' +
        'import { defineConfig } from "jint:sdk";\n' +
        'export default defineConfig({ rules: [...rules, { ...is_greppable, include: ["src/**"] }] });\n',
    );
    expect(async () => await loadTsConfig(path)).toThrow(/'is_greppable' is declared twice/);
  });

  test("override on a rule that replaces nothing is an error", async () => {
    const path = write(
      "override-nothing.config.ts",
      'import { is_greppable } from "jint:rules/naming";\n' +
        'import { defineConfig } from "jint:sdk";\n' +
        "export default defineConfig({ rules: [{ ...is_greppable, override: true }] });\n",
    );
    expect(async () => await loadTsConfig(path)).toThrow(/no earlier rule is named 'is_greppable'/);
  });

  test("importing a domain that does not exist names the ones that do", async () => {
    const path = write(
      "unknown-domain.config.ts",
      'import { rules } from "jint:rules/nope";\nexport default { rules };\n',
    );
    try {
      await loadTsConfig(path);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain("unknown rule domain");
      expect((e as Error).message).toContain("jint:rules/naming: is_vocabulary_consistent");
    }
  });

  test("a config with no rules names every domain and the rules in it", async () => {
    const path = write(
      "empty.config.ts",
      'import { defineConfig } from "jint:sdk";\nexport default defineConfig({});\n',
    );
    try {
      await loadTsConfig(path);
      expect.unreachable();
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("jint:rules/comments: ");
      expect(message).toContain("jint:rules/naming: is_vocabulary_consistent");
      expect(message).toContain('from "jint:rules/');
    }
  });

  test("a thrown module fails fatal (CONFIG_INVALID), naming the file", async () => {
    const path = write("throwing.config.ts", 'throw new Error("boom");');
    try {
      await loadTsConfig(path);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain(path);
      expect((e as Error).message).toContain("boom");
    }
  });

  test("a garbage default export fails the config boundary, not the gate", async () => {
    const path = write("garbage.config.ts", "export default { nope: true };");
    expect(async () => await loadTsConfig(path)).toThrow(/invalid config/);
  });

  test("duplicate names: a callback rule shadowing a declarative one is fatal", async () => {
    const path = write(
      "dup.config.ts",
      'import { is_greppable } from "jint:rules/naming";\n' +
        'import { defineConfig } from "jint:sdk";\n' +
        "export default defineConfig({ rules: [is_greppable, {\n" +
        '  name: "is_greppable", target: "comments",\n' +
        '  classify: () => ({ instructions: "i", criteria: { true: "t", false: "f" }, state: {} }),\n' +
        "  handle: { warn: { greater_than: 0.5 } },\n" +
        "}] });\n",
    );
    expect(async () => await loadTsConfig(path)).toThrow(/duplicate rule name/);
  });
});

describe("defineConfig validation (author-time, fatal)", () => {
  test("accepts the full config surface (minus customRules)", () => {
    const config = defineConfig({
      input: "src/",
      inputType: "dir",
      rules: [],
      include: ["**/*.ts"],
      exclude: ["**/*.test.ts"],
      disable: ["is_greppable"],
      apiKey: "k",
      concurrency: 8,
      timeout: 30,
    });
    expect(config.input).toBe("src/");
  });

  test("rejects keys outside the config surface", () => {
    expect(() => {
      defineConfig({ rules: [], customRules: ["x"] } as never);
    }).toThrow(/customRules/);
  });

  test("rejects non-objects and a non-array rules key", () => {
    expect(() => defineConfig([1, 2] as never)).toThrow(/config object/);
    expect(() => defineConfig({ rules: "x" } as never)).toThrow(/rules/);
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

  test("policy as a callback (a function handle) validates — the union's TS-only arm", () => {
    expect(typeof validateCustomRule({ ...ok, handle: () => [] }, "f.ts").handle).toBe("function");
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
      {}, // no tier at all
      { silent_band: [0.1, 0.2] }, // a band without a tier
    ];
    for (const handle of cases) {
      expect(() => validateCustomRule({ ...ok, handle }, "f.ts")).toThrow(/"is_fine": handle/);
    }
  });

  test("an error-only data handle validates (warn is optional)", () => {
    const rule = validateCustomRule({ ...ok, handle: { error: { greater_than: 0.6 } } }, "f.ts");
    expect(rule.handle).toEqual({ error: { greater_than: 0.6 } });
  });

  test("score kind rejected as not-yet-supported", () => {
    expect(() => validateCustomRule({ ...ok, kind: "score" }, "f.ts")).toThrow(/noul/);
  });
});
