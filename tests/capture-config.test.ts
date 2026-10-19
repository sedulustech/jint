import { afterEach, describe, expect, jest, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  captureFor,
  collectReport,
  lint,
  loadConfig,
  type CapturedElement,
  type Classifier,
  type ResolvedConfig,
} from "../packages/sdk/src/index.ts";
import { runCli } from "./helpers/cli.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";

// capture's config scope, e2e-first: the behavior matrix from the design - config-input parity with
// run (element-for-element), config excludes applied to an explicit target, --rule preview marking
// exactly what a real lint run measures, unknown-rule loud, config-error parity. The SDK-level
// claims run in-process through the PUBLIC surface (loadConfig + lint with a stub transport +
// captureFor); the CLI-level claims spawn the binary (usage matrix, marker column, stderr shapes).

jest.setTimeout(60_000);

const ROOT_DIR = scratchDir("jint-capture-config");

/**
 * The probe tree: src/a.ts (4 definitions + 1 owned comment), src/b.py (1 function), src/gen/g.ts
 * (pruned by config).
 */
function writeTree(dir: string): void {
  mkdirSync(join(dir, "src", "gen"), { recursive: true });
  mkdirSync(join(dir, "other"), { recursive: true });
  writeFileSync(
    join(dir, "src", "a.ts"),
    "// lead\nfunction alpha() {}\nconst b = 1;\nclass K { m() {} }\n",
  );
  writeFileSync(join(dir, "src", "b.py"), "def beta():\n    pass\n");
  writeFileSync(join(dir, "src", "gen", "g.ts"), "function genfn() {}\n");
  writeFileSync(join(dir, "other", "doc.md"), "# Title\n\npara\n");
}

// The probe rule: targets EVERY element lane jointly, so lint measures each element exactly once
// and the preview's marks must equal the measurement set exactly.
const PROBE_RULE = {
  name: "probe_all",
  instructions: "probe",
  criteria: { true: "t", false: "f" },
  target: ["definitions", "comments", "loose-comments", "imports"],
  handle: { warn: { greater_than: 0.9 } },
};

const PROBE_CONFIG = JSON.stringify(
  { input: "src", exclude: ["**/gen/**"], rules: [PROBE_RULE] },
  null,
  2,
);

/** The stub transport: a real lint pipeline with the vendor answered 0.5 for every question. */
const classifier: Classifier = async (_state, questions) => {
  const answers: Record<string, { value: number }> = {};
  for (const id of Object.keys(questions)) answers[id] = { value: 0.5 };
  return answers;
};

/** (input file, span start byte, span end line, kind) - one element's identity in both shapes. */
const identity = (e: {
  input: string;
  span: { startByte: number; end: { line: number } };
  kind: string;
}) => `${e.input}#${e.span.startByte}#${e.span.end.line}#${e.kind}`;

/** The element identities a report measured (input carries the run-scoped uuid suffix). */
const measuredIdentities = (report: Awaited<ReturnType<typeof collectReport>>) =>
  report.measurements
    .filter((m) => m.element !== undefined)
    .map((m) =>
      identity({
        input: m.input.split("#")[0]!,
        span: m.element!.span,
        kind: m.element!.kind,
      }),
    )
    .sort();

const capturedIdentities = (elements: readonly CapturedElement[]) => elements.map(identity).sort();

afterEach(() => {
  rmScratchTree(ROOT_DIR);
});

/**
 * Run the body with the process cwd inside the config dir: config.input is invocation-relative
 * (run's semantic - the CLI spawns with the user's cwd), so the in-process twin must adopt the same
 * cwd to walk the same tree.
 */
async function withCwd<T>(dir: string, body: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await body();
  } finally {
    process.chdir(prev);
  }
}

describe("captureFor - the config scope, run parity (sdk surface)", () => {
  test("no target walks the config's input: element-for-element with a real lint run", async () => {
    const dir = join(ROOT_DIR, "parity");
    rmScratchTree(dir);
    writeTree(dir);
    writeFileSync(join(dir, "jint.config.json"), PROBE_CONFIG);

    await withCwd(dir, async () => {
      const config: ResolvedConfig = await loadConfig(join(dir, "jint.config.json"));
      // the real run: lint()'s whole pipeline over the same resolved config, transport stubbed
      const report = await collectReport(lint({ config, classifier }));
      expect(report.errors).toEqual([]);

      const elements = await captureFor(config)();
      // FILE-SET parity: capture walked exactly the files the run measured, under the config's
      // input and excludes (not the process cwd)
      const measuredFiles = new Set(report.measurements.map((m) => m.input.split("#")[0]!));
      expect(new Set(elements.map((e) => e.input))).toEqual(measuredFiles);
      expect(new Set(elements.map((e) => e.input))).toEqual(new Set(["a.ts", "b.py"]));
      // ELEMENT parity, subset direction: every element the run measured is in capture's output,
      // identity for identity (the reverse cannot be exact by design: a pair-frame comment - a
      // comment a definition owns - is measured THROUGH its definition, never as its own element,
      // so capture lists one element the measurements fold into another)
      const identities = new Set(capturedIdentities(elements));
      for (const id of measuredIdentities(report)) expect(identities.has(id)).toBe(true);
      // the pair-frame case itself, pinned: a.ts's owned leading comment is captured, its
      // definition is the measured unit (the preview test pins the exact marked population)
      expect(
        elements
          .filter((e) => e.input === "a.ts")
          .map((e) => e.kind)
          .sort(),
      ).toEqual(["binding", "class", "comment", "function", "method"]);
    });
  });

  test("--rule preview marks EXACTLY the population the run measures (the cross-check)", async () => {
    const dir = join(ROOT_DIR, "preview");
    rmScratchTree(dir);
    writeTree(dir);
    writeFileSync(join(dir, "jint.config.json"), PROBE_CONFIG);

    await withCwd(dir, async () => {
      const config = await loadConfig(join(dir, "jint.config.json"));
      const report = await collectReport(lint({ config, classifier }));
      const marked = await captureFor(config, { rule: "probe_all" })();
      const matched = marked.filter((e) => e.matches === true);

      // count parity against the real run's measurements, then identity parity
      expect(matched.length).toBe(report.measurements.length);
      expect(capturedIdentities(matched)).toEqual(measuredIdentities(report));
      // absent, never false: an unmarked element carries no matches key at all
      expect(marked.some((e) => e.matches === false)).toBe(false);
      expect(marked.filter((e) => !("matches" in e)).length).toBe(marked.length - matched.length);
    });
  });

  test("the rule's own scope globs narrow the preview (issue 008 lists)", async () => {
    const dir = join(ROOT_DIR, "scopes");
    rmScratchTree(dir);
    writeTree(dir);
    writeFileSync(
      join(dir, "jint.config.json"),
      JSON.stringify({
        input: "src",
        exclude: ["**/gen/**"],
        rules: [{ ...PROBE_RULE, include: ["**/*.ts"] }],
      }),
    );
    await withCwd(dir, async () => {
      const config = await loadConfig(join(dir, "jint.config.json"));
      const marked = await captureFor(config, { rule: "probe_all" })();
      // the rule's include claims every .ts across the config exclude (jurisdiction: a rule
      // scope beats the config exclude for the files it names, walk-union); b.py is scoped out
      // by the include. So gen/g.ts enters the walk AND is marked - the exclude alone cannot
      // stop a rule that names the file.
      expect(marked.filter((e) => e.matches === true).map((e) => e.input)).toEqual([
        "a.ts",
        "a.ts",
        "a.ts",
        "a.ts",
        "gen/g.ts",
      ]);
      expect(marked.filter((e) => e.input === "b.py").every((e) => !("matches" in e))).toBe(true);
    });
  });

  test("config excludes apply to an explicit target; --exclude unions on top", async () => {
    const dir = join(ROOT_DIR, "excludes");
    rmScratchTree(dir);
    writeTree(dir);
    writeFileSync(join(dir, "jint.config.json"), PROBE_CONFIG);

    await withCwd(dir, async () => {
      const config = await loadConfig(join(dir, "jint.config.json"));
      const walked = await captureFor(config)("src");
      expect(walked.every((e) => !e.input.includes("gen/"))).toBe(true);

      const narrower = await captureFor(config, { exclude: ["**/b.py"] })("src");
      expect(narrower.some((e) => e.input.endsWith("b.py"))).toBe(false);
    });
  });

  test("unknown rule name is run's own --rule error, naming the valid set", async () => {
    const dir = join(ROOT_DIR, "unknown");
    rmScratchTree(dir);
    writeTree(dir);
    writeFileSync(join(dir, "jint.config.json"), PROBE_CONFIG);
    const config = await loadConfig(join(dir, "jint.config.json"));
    expect(() => captureFor(config, { rule: "nope" })).toThrow('unknown rule "nope"');
  });

  test("a custom (callback) rule previews through run's own target resolver", async () => {
    const dir = join(ROOT_DIR, "custom");
    rmScratchTree(dir);
    writeTree(dir);
    writeFileSync(
      join(dir, "jint.config.ts"),
      [
        "export default {",
        '  input: "src",',
        '  exclude: ["**/gen/**"],',
        "  rules: [{",
        '    name: "pick_functions",',
        '    target: "functions",',
        "    classify: (self) => ({",
        '      instructions: "i",',
        '      criteria: { true: "t", false: "f" },',
        "      state: { src: self.source },",
        "    }),",
        "    handle: () => [],",
        "  }],",
        "};",
        "",
      ].join("\n"),
    );
    await withCwd(dir, async () => {
      const config = await loadConfig(join(dir, "jint.config.ts"));
      const marked = await captureFor(config, { rule: "pick_functions" })();
      // the custom tier's resolver picked exactly the function elements: alpha, beta (gen pruned)
      const matched = marked.filter((e) => e.matches === true);
      expect(matched.map((e) => `${e.kind}@${e.input}`).sort()).toEqual([
        "function@a.ts",
        "function@b.py",
      ]);
    });
  });
});

describe("jint capture - the config scope through the spawned binary", () => {
  test("no target, config input: same element set the config declares, gen pruned, exit 0", async () => {
    const dir = join(ROOT_DIR, "cli-parity");
    rmScratchTree(dir);
    writeTree(dir);
    writeFileSync(join(dir, "jint.config.json"), PROBE_CONFIG);
    const r = await runCli(["capture"], { cwd: dir });
    expect(r.code).toBe(0);
    const inputs = new Set(
      r.stdout
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => l.split(" ").at(-1)),
    );
    expect(inputs).toEqual(new Set(["a.ts", "b.py"]));
  });

  test("--rule preview: the marker column marks the population, JSON carries matches: true", async () => {
    const dir = join(ROOT_DIR, "cli-preview");
    rmScratchTree(dir);
    writeTree(dir);
    writeFileSync(
      join(dir, "jint.config.json"),
      JSON.stringify({
        input: "src",
        exclude: ["**/gen/**"],
        rules: [{ ...PROBE_RULE, include: ["**/*.ts"] }],
      }),
    );
    const lines = await runCli(["capture", "--rule", "probe_all"], { cwd: dir });
    expect(lines.code).toBe(0);
    const rows = lines.stdout.split("\n").filter((l) => l !== "");
    expect(rows.some((l) => l.startsWith("* "))).toBe(true);
    expect(rows.some((l) => l.startsWith("  "))).toBe(true);
    // the population is a.ts's definitions plus gen/g.ts (jurisdiction: the rule's include
    // names every .ts, claiming gen/g.ts across the config exclude); b.py scoped out by include
    expect(rows.filter((l) => l.startsWith("* ")).map((l) => l.slice(2))).toEqual([
      "typescript function L2-L2 alpha a.ts",
      "typescript binding L3-L3 b a.ts",
      "typescript class L4-L4 K a.ts",
      "typescript method L4-L4 m a.ts",
      "typescript function L1-L1 genfn gen/g.ts",
    ]);

    const json = await runCli(["capture", "--rule", "probe_all", "--json"], { cwd: dir });
    expect(json.code).toBe(0);
    const parsed = JSON.parse(json.stdout) as { elements: CapturedElement[] };
    expect(parsed.elements.filter((e) => e.matches === true).length).toBe(5);
    expect(parsed.elements.some((e) => e.matches === false)).toBe(false);
  });

  test("config excludes apply to an explicit target; --exclude unions on top", async () => {
    const dir = join(ROOT_DIR, "cli-excludes");
    rmScratchTree(dir);
    writeTree(dir);
    writeFileSync(join(dir, "jint.config.json"), PROBE_CONFIG);
    const r = await runCli(["capture", "src", "--exclude", "**/b.py"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("genfn");
    expect(r.stdout).not.toContain("beta");
    expect(r.stdout).toContain("alpha");
  });

  test("config-scope basis: patterns relative to the config dir prune an explicit dir target", async () => {
    const dir = join(ROOT_DIR, "cli-scopebase");
    rmScratchTree(dir);
    mkdirSync(join(dir, "sub", "deep"), { recursive: true });
    writeFileSync(join(dir, "sub", "keep.ts"), "function keep() {}\n");
    writeFileSync(join(dir, "sub", "deep", "gone.ts"), "function gone() {}\n");
    writeFileSync(
      join(dir, "jint.config.json"),
      JSON.stringify({ exclude: ["sub/deep/**"], rules: [PROBE_RULE] }),
    );
    const r = await runCli(["capture", "sub"], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("keep");
    expect(r.stdout).not.toContain("gone");
  });

  test("unknown rule: exit 2, run's exact unknown-rule rendering with the (--rule) origin", async () => {
    const dir = join(ROOT_DIR, "cli-unknown");
    rmScratchTree(dir);
    writeTree(dir);
    writeFileSync(join(dir, "jint.config.json"), PROBE_CONFIG);
    const r = await runCli(["capture", "--rule", "nope"], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('jint: unknown rule "nope" (--rule)');
    expect(r.stderr).toContain("valid: probe_all");
  });

  test("two --rule names: one preview at a time, loud", async () => {
    const dir = join(ROOT_DIR, "cli-two-rules");
    rmScratchTree(dir);
    writeTree(dir);
    writeFileSync(join(dir, "jint.config.json"), PROBE_CONFIG);
    const r = await runCli(["capture", "--rule", "probe_all", "--rule", "probe_all"], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("jint capture previews one rule at a time");
  });

  test("config-error parity: capture fails with run's exact error, same scope, same message", async () => {
    const dir = join(ROOT_DIR, "cli-broken");
    rmScratchTree(dir);
    writeTree(dir);
    writeFileSync(join(dir, "jint.config.json"), "{ broken: true }");
    const run = await runCli(["run", "src", "--json"], { cwd: dir });
    const cap = await runCli(["capture", "src", "--json"], { cwd: dir });
    expect(run.code).toBe(2);
    expect(cap.code).toBe(2);
    expect(cap.stderr.split("\n")[0]).toBe(run.stderr.split("\n")[0]);
    expect(cap.stderr).toContain("config file is not valid JSON");
  });

  test("no config, no target: the existing usage error, now naming the config scope too", async () => {
    const dir = join(ROOT_DIR, "cli-bare");
    rmScratchTree(dir);
    writeTree(dir);
    const r = await runCli(["capture"], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("jint capture expects a target path");
    expect(r.stderr).toContain("or set input in the config");
  });

  test("no config file: the built-in defaults scope - its fixtures exclude prunes the walk (run parity)", async () => {
    const dir = join(ROOT_DIR, "cli-defaults");
    rmScratchTree(dir);
    mkdirSync(join(dir, "fixtures"), { recursive: true });
    writeFileSync(join(dir, "fixtures", "f.ts"), "function fx() {}\n");
    writeFileSync(join(dir, "keep.ts"), "function keep() {}\n");
    const r = await runCli(["capture", "."], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("keep");
    expect(r.stdout).not.toContain("fx");
  });
});
