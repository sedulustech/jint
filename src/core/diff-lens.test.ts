import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { defaultConfig } from "../config/load.ts";
import { collectReport, lint, type LintReport } from "./lint.ts";
import { buildDiffLens } from "./tsrules/execute.ts";
import type { TsElement } from "./tsrules/sdk.ts";
import type { LintEvent } from "./types.ts";
import type { Classifier } from "./types.ts";

// The ctx.diff lens (paths-only): the changed-file list is knowledge about the judged things.
// Undefined without a list; defined-but-empty is LOUD (the seed rule warns), never silence.

const baseConfig = { ...defaultConfig(), input: "", exclude: [] as string[] };
const DIR = "tmp/diff-lens-test";
const RULE_PATH = DIR + "/lens-rule.ts";
const LIST_PATH = DIR + "/changed.txt";

const FIXTURE_FILES: Record<string, string> = {
  "changed.ts": "export function a(): number {\n  return 1;\n}\n",
  "untouched.ts": "export function x(): number {\n  return 2;\n}\n",
};

/** A TS rule that serializes ctx.diff into its judged state, so tests read the lens per call. */
const LENS_RULE = [
  'import { defineConfig } from "jint:sdk";',
  "export default defineConfig({",
  "  rules: [{",
  '    name: "is_lens_probe",',
  '    target: "functions",',
  "    classify: (self, ctx) => ({",
  '      instructions: "i",',
  '      criteria: { true: "t", false: "f" },',
  "      state: { ctxdiff: JSON.stringify(ctx.diff ?? null), source: self.source },",
  "    }),",
  "    handle: { warn: { greater_than: 0.1 }, error: { greater_than: 0.2 } },",
  "  }],",
  "});",
].join("\n");

const classifier: Classifier = async (_state, questions) =>
  Object.fromEntries(Object.keys(questions).map((k) => [k, 0.5]));

function setup(): void {
  mkdirSync(DIR + "/src", { recursive: true });
  for (const [name, content] of Object.entries(FIXTURE_FILES)) {
    writeFileSync(DIR + "/src/" + name, content);
  }
  writeFileSync(RULE_PATH, LENS_RULE);
}

/** A classifier capturing the ctxdiff string the probe rule put in its state. */
function capturingClassifier(states: string[]): Classifier {
  return async (state, questions) => {
    const s = state as { ctxdiff?: string };
    if (typeof s.ctxdiff === "string") states.push(s.ctxdiff);
    return Object.fromEntries(Object.keys(questions).map((k) => [k, 0.5]));
  };
}

type Lens = { paths: string[]; file: Array<{ path: string; id: string }>; raw?: string };

function drain(events: AsyncIterable<LintEvent>): Promise<LintReport> {
  return collectReport(events);
}

afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe("ctx.diff — the lens (paths-only)", () => {
  test("subsetting: per-kind views are the target grammar filtered to changed paths", () => {
    const element = (path: string, role: TsElement["role"], id: string): TsElement =>
      ({
        id,
        path,
        role,
        source: "x",
        span: {
          start: { line: 1, column: 0 },
          end: { line: 1, column: 1 },
          startByte: 0,
          endByte: 1,
        },
        parent: null,
      }) as unknown as TsElement;
    const all = [
      element("changed.ts", "function", "d0"),
      element("changed.ts", "comment", "c0"),
      element("untouched.ts", "function", "d1"),
    ];
    const lens = buildDiffLens(["changed.ts"], all);
    expect(lens.paths).toEqual(["changed.ts"]);
    // file = every element of a changed path (any role)
    expect(lens.file.map((e: TsElement) => e.id)).toEqual(["d0", "c0"]);
    expect(lens.functions.map((e: TsElement) => e.id)).toEqual(["d0"]);
    expect(lens.comments.map((e: TsElement) => e.id)).toEqual(["c0"]);
    expect(lens.definitions).toEqual([]);
    expect(lens.imports).toEqual([]);
    // no raw key: there is no patch in the paths-only lens
    expect("raw" in lens).toBe(false);
  });

  test("--changed populates ctx.diff on every classify call; the subject is the list", async () => {
    setup();
    writeFileSync(LIST_PATH, DIR + "/src/changed.ts\n");
    const states: string[] = [];
    const report = await drain(
      lint({
        config: { ...baseConfig, rules: [], tsRules: [RULE_PATH] },
        changed: LIST_PATH,
        classifier: capturingClassifier(states),
      }),
    );
    // only the CHANGED file was judged (the list selected the subject)
    expect(states).toHaveLength(1);
    expect(report.measurements).toHaveLength(1);
    const lens = JSON.parse(states[0]!) as Lens;
    expect(lens.paths).toEqual([DIR + "/src/changed.ts"]);
    expect(lens.file.map((e) => e.path)).toEqual([DIR + "/src/changed.ts"]);
    expect("raw" in lens).toBe(false);
  });

  test("no list -> ctx.diff is undefined (a rule can distinguish absence from empty)", async () => {
    setup();
    const states: string[] = [];
    await drain(
      lint({
        config: { ...baseConfig, rules: [], tsRules: [RULE_PATH] },
        input: DIR + "/src",
        classifier: capturingClassifier(states),
      }),
    );
    expect(states.length).toBe(2);
    for (const s of states) expect(JSON.parse(s)).toBeNull();
  });

  test("empty list -> ctx.diff defined-but-empty (and the input backstop names it)", async () => {
    setup();
    writeFileSync(LIST_PATH, "");
    await expect(
      drain(
        lint({
          config: { ...baseConfig, rules: [], tsRules: [RULE_PATH] },
          changed: LIST_PATH,
          classifier,
        }),
      ),
    ).rejects.toThrow(/selected no files/);
  });

  test("a list naming only paths outside the input still walks them (entries ARE the subject)", async () => {
    setup();
    writeFileSync(LIST_PATH, DIR + "/src/changed.ts\n");
    const states: string[] = [];
    const report = await drain(
      lint({
        config: { ...baseConfig, rules: [], tsRules: [RULE_PATH] },
        changed: LIST_PATH,
        classifier: capturingClassifier(states),
      }),
    );
    // absolute-ish (root-relative) entries are the file's verbatim identity; the lens matches
    expect(states).toHaveLength(1);
    const lens = JSON.parse(states[0]!) as Lens;
    expect(lens.paths).toEqual([DIR + "/src/changed.ts"]);
    expect(report.measurements).toHaveLength(1);
  });

  test("rules that never read ctx.diff are untouched by its presence", async () => {
    setup();
    const run = (changed?: string) =>
      drain(
        lint({
          config: {
            ...baseConfig,
            rules: [
              {
                name: "is_oblivious",
                kind: "noul",
                criteria: { true: "t", false: "f" },
                target: "definitions",
                handle: () => null, // never fires: the rule classifies, nothing is actionable
              } as never,
            ],
            tsRules: [],
          },
          input: DIR + "/src",
          ...(changed !== undefined ? { changed } : {}),
          classifier,
        }),
      );
    const without = await run();
    writeFileSync(LIST_PATH, "changed.ts\n");
    const withLens = await run(LIST_PATH);
    expect(withLens.measurements.map((m) => [m.rule, m.input] as const)).toEqual(
      without.measurements.map((m) => [m.rule, m.input] as const),
    );
    expect(without.measurements.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The seed rule: examples/rules/docs-fit-diff.ts — loud on defined-but-empty.

describe("docs-fit-diff — the seed rule (contract)", () => {
  test("loads as a config fragment", async () => {
    const { loadTsConfigRules } = await import("./tsrules/loader.ts");
    const loaded = await loadTsConfigRules(["examples/rules/docs-fit-diff.ts"]);
    expect(loaded.map((r) => r.name)).toEqual(["is_doc_fit"]);
  });

  test("a lens that matched nothing is LOUD: one warn, never a silent pass", async () => {
    setup();
    // Explicit input + a list whose entries match nothing in that walk: defined-but-empty.
    // The seed must answer warn on its first element, never silent.
    writeFileSync(LIST_PATH, "/nonexistent-root/elsewhere.ts\n");
    const report = await drain(
      lint({
        config: {
          ...baseConfig,
          rules: [],
          tsRules: ["examples/rules/docs-fit-diff.ts"],
        },
        input: DIR + "/src",
        changed: LIST_PATH,
        classifier,
      }),
    );
    expect(report.measurements.length).toBeGreaterThan(0);
    // findings carry no message (v1 contract): loudness is the rule+severity, joined to the config
    const lensWarns = report.findings.filter(
      (f) => f.rule === "is_doc_fit" && f.severity === "warn",
    );
    expect(lensWarns).toHaveLength(1);
  });
});
