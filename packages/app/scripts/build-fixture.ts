/**
 * BUILDER 2 of 2 — the REAL-PIPELINE generated case fixture (generated/elements). Runs the actual
 * engine end to end (fixture-pipeline design, tmp/designs/fixture-pipeline.md): walk.ts ->
 * classify.ts -> provider record captures -> the engine's report/manifest writers. No hand-built
 * capture shapes — the fixture is what the engine actually emits, so format changes (like uuid
 * element ids) are absorbed by regenerating.
 *
 * Usage: bun run fixtures:gen (from packages/app)
 *
 * Source dir : tests/fixtures/sources/elements/ (real TS files, checked in) output run :
 * tests/fixtures/generated/elements/ (captures + report.json + manifest.json, committed; the API
 * serves it as the nested run "generated/elements")
 *
 * Determinism: regeneration is byte-identical. The only stubbed piece is the transport — a fetch
 * that answers every question with a fixed per-rule value (the engine's own lint tests stub
 * classifiers the same way); the Decisions adapter, the recorder, question compilation, state
 * shapes, and report writing are all real, and the captures are the Decisions exchange itself. The
 * engine's own per-run entropy is sealed inside this script, not in packages/sdk:
 *
 * - Element uuids: crypto.randomUUID is temporarily wrapped with a counter-seeded sha256 minter (uuid
 *   v4 shape, unique within the run) so the finding.input == capture id join survives
 * - Capture filenames: the recorder's <unixts>- prefix is replaced on hoist by a fixed one (the run
 *   store only recognizes a request file by a 13-digit prefix; the -<n> suffixes that disambiguate
 *   multiple captures per source stay)
 * - Timestamps/durations/paths: captures' ts and durationMs, the manifest ts/durationMs/cwd, and the
 *   report's run.id/run.dir are replaced with the sentinels below
 * - Tests assert shapes and relationships, never uuids; fixture-determinism.test.ts asserts the
 *   byte-identical property itself.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { allRules as allSpecs } from "@jint/rules";
import {
  collectReport,
  compileRule,
  createClassifier,
  lint,
  renderJson,
  recordSummary,
  recordRunManifest,
  recordRunReport,
  type Classifier,
  type ClassifierConfig,
  type Rule,
} from "@jint/sdk";

/** Fixed stand-ins for the wall-clock values the engine stamps on a run. */
const SENTINEL_TS = "1970-01-01T00:00:00.000Z";
const SENTINEL_RUN_ID = "0";
// the run store lists a request file by its 13-digit prefix (isRequestFile in the SDK's run API)
const SENTINEL_CAPTURE_PREFIX = "0000000000000-";
/** Path stand-ins, relative so regenerating from any worktree yields the same bytes. */
const SENTINEL_CWD = "packages/app";
const SENTINEL_RUN_DIR = "tmp/fixtures-gen/0";

const appRoot = resolve(import.meta.dir, "..");
const sourceDir = resolve(appRoot, "tests/fixtures/sources/elements");
const defaultOutDir = resolve(appRoot, "tests/fixtures/generated/elements");
// staging under tmp (gitignored); recording writes to <base>/<runid>/ and we hoist that one dir
const stagingDir = resolve(appRoot, "../..", "tmp/fixtures-gen");

/**
 * Deterministic per-rule answers (p-space noul values; the score-kind set moves with the defaults,
 * so the stub derives distributions generically - only the DESIGNED shapes are named below). Chosen
 * to exercise severity variety: errors (is_cognitively_complex 2, and every finding it produces),
 * warns (will_error_lose_cause 0.5 > warn_at 0.4), the rest in-band.
 */
const VALUES: Record<string, number> = {
  // the rest sit inside the healthy band of their handles; will_error_lose_cause 0.5 -> warn
  // (greater_than 0.4), is_readable score 2 -> warn (score map: 0,1 pass; 2 warn; 3 error).
  is_function_srp: 0.5,
  will_error_lose_cause: 0.5,
  is_vocabulary_consistent: 0.9,
  has_filename_mismatch: 0.3,
  is_greppable: 0.9,
  is_comment_narration: 0.1,
  is_comment_patching_readability: 0.1,
  will_comment_drift: 0.1,
  // scored rubric: 2 = warn (score map 0,1 pass; 2 warn) - with its mass split between distant
  // levels (see SCORE_PROBABILITIES below)
  is_cognitively_complex: 2,
  is_readable: 2,
};

/**
 * Per-score-rule answer distributions. A score reads as the expected level of its distribution, so
 * is_cognitively_complex splits its mass between the distant levels 0 and 2 while its expectation
 * (1.55) still crosses the rule's error line (1.5) - a bimodal distribution.
 */
const SCORE_PROBABILITIES: Record<string, Record<string, number>> = {
  is_cognitively_complex: { "0": 0.2, "1": 0.05, "2": 0.75 },
};

/**
 * The provider's own confidence, set on a few score answers only: the rest carry none, as an answer
 * does when the provider sends none. A bimodal split reads low, a concentrated answer high.
 */
const CONFIDENCE: Record<string, number> = {
  is_cognitively_complex: 0.36,
  is_readable: 1,
};

/**
 * The distribution whose expected level is `value`: the mass sits on the two levels around it, so
 * the reading the rules take back is the designed value exactly.
 */
function aroundScore(value: number, levels: number): Record<string, number> {
  const low = Math.min(levels - 1, Math.floor(value));
  const up = Math.min(levels - 1, low + 1);
  const share = low === up ? 0 : value - low;
  return Object.fromEntries(
    Array.from({ length: levels }, (_, i) => [
      String(i),
      i === low && i === up ? 1 : i === low ? 1 - share : i === up ? share : 0,
    ]),
  );
}

/** The rule names of the call being answered: the request names its questions only by position. */
const askedRules = new AsyncLocalStorage<string[]>();

/** Fake transport: answers the way POST /v1/decisions would, with fixed per-rule values. */
function stubFetch(): NonNullable<ClassifierConfig["fetch"]> {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      questions: { type: string; name: string; levels?: { label: string }[] }[];
    };
    const rules = askedRules.getStore() ?? [];
    const answers = body.questions.map((q, i) => {
      // element questions are keyed by bare rule name; file questions "<rule> in <id>"
      const rule = (rules[i] ?? "").split(" in ")[0]!;
      if (q.type === "score") {
        const levels = q.levels!.map((l) => l.label);
        const value = VALUES[rule] ?? 1;
        const distribution = SCORE_PROBABILITIES[rule] ?? aroundScore(value, levels.length);
        return {
          type: "score",
          name: q.name,
          confidence: CONFIDENCE[rule],
          probabilities: levels.map((label) => ({
            value: label,
            probability: distribution[label] ?? 0,
          })),
        };
      }
      return { type: "predicate", name: q.name, probability: VALUES[rule] ?? 0.9 };
    });
    return new Response(
      JSON.stringify({
        model: body.model,
        answers,
        usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}

/**
 * The catalog compiled from the rules packages through the sdk's public seam — the same compile
 * packages/cli/src/baseline.ts performs. no config object is on the sdk surface, so the script
 * builds its own.
 */
const baseline: Record<string, Rule> = Object.fromEntries(
  allSpecs.map((spec) => {
    const rule = compileRule(spec as never, "@jint/rules");
    return [rule.name, rule];
  }),
);

/**
 * Deterministic stand-in for crypto.randomUUID: counter-seeded sha256 formatted as uuid v4 (version
 * nibble 4, variant 8). Unique within the run, identical across runs — the same uniqueness
 * guarantee the engine's per-run uuidv4 provides, without wall-clock entropy. The engine's real
 * minter is restored in the finally block; packages/sdk is never touched.
 */
function deterministicUuidMinter(): () => string {
  const real = crypto.randomUUID.bind(crypto);
  let ordinal = 0;
  crypto.randomUUID = () => {
    const h = createHash("sha256")
      .update("fixture-element-" + String(ordinal++))
      .digest("hex");
    return (
      h.slice(0, 8) +
      "-" +
      h.slice(8, 12) +
      "-4" +
      h.slice(13, 16) +
      "-8" +
      h.slice(17, 20) +
      "-" +
      h.slice(20, 32)
    );
  };
  return real;
}

/** The classifier, with each call's rule names kept where the stub transport can read them. */
function named(inner: Classifier): Classifier {
  return (state, questions) =>
    askedRules.run(Object.keys(questions), () => inner(state, questions));
}

type FixtureReport = Awaited<ReturnType<typeof collectReport>>;

/**
 * Lints the fixture sources with the stub classifier while recording into the staging root, then
 * writes the run's report and manifest with the sentinels in place of their per-run values.
 */
async function recordFixtureRun(): Promise<FixtureReport> {
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  // recording starts with the first classifier call, so the staging root is set before it
  process.env.JINT_RUNS_DIR = stagingDir;
  const config = {
    input: "",
    rules: Object.values(baseline),
    customRules: [],
    include: [],
    exclude: [],
  };
  const realRandomUUID = deterministicUuidMinter();
  let report;
  try {
    report = await collectReport(
      lint({
        config,
        input: sourceDir,
        inputType: "dir",
        classifier: named(
          createClassifier({
            apiKey: "fixture-key",
            cache: false,
            fetch: stubFetch(),
          }),
        ),
      }),
    );
  } finally {
    crypto.randomUUID = realRandomUUID;
  }
  report.run.id = SENTINEL_RUN_ID;
  report.run.dir = SENTINEL_RUN_DIR;
  report.run.durationMs = 0;
  recordRunReport(renderJson(report));
  recordRunManifest({
    configPath: "fixtures/sources/elements",
    cwd: SENTINEL_CWD,
    argv: ["bun", "fixtures:gen"],
    createdAt: SENTINEL_TS,
    updatedAt: SENTINEL_TS,
    handles: Object.fromEntries(
      config.rules.flatMap((r) => (r.handleData ? [[r.name, r.handleData] as const] : [])),
    ),
  });
  const summary = recordSummary();
  if (summary === null || summary.count === 0)
    throw new Error("recording wrote no captures; generator is broken");
  return report;
}

interface StagedCapture {
  base: string;
  raw: string;
  /** The content without its per-run ts and durationMs, so ordering on it is the same every run. */
  key: string;
  json: Record<string, unknown> | null;
}

/** Every file of every run dir under the staging root, under its name without the <unixts>- stamp. */
function readStagedCaptures(): StagedCapture[] {
  const runDirs = readdirSync(stagingDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (runDirs.length === 0) throw new Error(`no record run dirs under ${stagingDir}`);
  const staged: StagedCapture[] = [];
  for (const run of runDirs) {
    for (const f of readdirSync(join(stagingDir, run))) {
      const raw = readFileSync(join(stagingDir, run, f), "utf8");
      const dest = f.replace(/^\d+-/, "");
      if (dest === "report.json") {
        staged.push({ base: dest, raw, key: dest, json: null });
        continue;
      }
      if (dest === "manifest.json") {
        // durationMs is the recorder's own stamp; createdAt and updatedAt are already sentinels
        const manifest = JSON.parse(raw) as Record<string, unknown>;
        manifest.durationMs = 0;
        staged.push({ base: dest, raw, key: dest, json: manifest });
        continue;
      }
      const base = dest.replace(/-\d+\.json$/, ".json");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      delete parsed.ts;
      delete parsed.durationMs;
      staged.push({ base, raw, key: JSON.stringify(parsed), json: parsed });
    }
  }
  return staged;
}

/**
 * Writes the staged captures to outDir under stable names. One lint can record into several run
 * dirs (each classifier seam starts its own recorder), and the recorder's <unixts>- stamp and -<n>
 * collision suffixes depend on timing, so names are rebuilt: path-keyed, with -<n> suffixes
 * assigned by content order. Each capture's ts and durationMs become the sentinels.
 */
function hoistCaptures(outDir: string): void {
  const staged = readStagedCaptures();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  staged.sort((a, b) => a.base.localeCompare(b.base) || (a.key < b.key ? -1 : 1));
  const groupCounts = new Map<string, number>();
  for (const { base, raw, json } of staged) {
    const seen = groupCounts.get(base) ?? 0;
    groupCounts.set(base, seen + 1);
    const unique = seen === 0 ? base : base.replace(/\.json$/, "-" + String(seen) + ".json");
    const name =
      base === "report.json" || base === "manifest.json"
        ? unique
        : SENTINEL_CAPTURE_PREFIX + unique;
    if (json === null) {
      writeFileSync(join(outDir, name), raw);
      continue;
    }
    if (base !== "manifest.json") json.ts = SENTINEL_TS;
    json.durationMs = 0;
    writeFileSync(join(outDir, name), JSON.stringify(json, null, 2) + "\n");
  }
  rmSync(stagingDir, { recursive: true, force: true });
}

/**
 * Formats the fixture as the repository formats it, so the builder's output is the committed bytes:
 * oxfmt collapses short arrays that JSON.stringify writes on several lines.
 */
function formatFixture(outDir: string): void {
  const formatted = Bun.spawnSync(["bunx", "oxfmt", outDir], { cwd: appRoot });
  if (formatted.exitCode !== 0)
    throw new Error("oxfmt failed on the generated fixture", {
      cause: new TextDecoder().decode(formatted.stderr),
    });
}

async function verifyFixture(outDir: string, report: FixtureReport): Promise<void> {
  const elementIds = new Set<string>();
  const fixtureFiles = readdirSync(outDir).filter((file) => file.endsWith(".json"));
  const readCapture = async (file: string) =>
    JSON.parse(await Bun.file(join(outDir, file)).text()) as {
      id?: unknown;
      request?: { input?: { content?: { data?: { source?: string } }[] }[] };
    };
  for (const file of fixtureFiles) {
    if (file === "report.json" || file === "manifest.json") continue;
    const capture = await readCapture(file);
    if (capture.request?.input?.[0]?.content?.[0]?.data?.source !== undefined) {
      const captureId = capture.id;
      if (typeof captureId !== "string" || !/^[0-9a-f-]{36}$/.test(captureId))
        throw new Error(`element capture ${file} lacks a uuid id: ${String(captureId)}`);
      elementIds.add(captureId);
    }
  }
  for (const classification of report.classifications) {
    if (classification.input.includes("#L"))
      throw new Error(`positional input leaked: ${classification.input}`);
    if (classification.element === undefined)
      throw new Error(`classification ${classification.input} lacks the element projection`);
    if (classification.element.kind === "file") continue;
    const suffix = classification.input.split("#")[1];
    if (suffix === undefined || !elementIds.has(suffix))
      throw new Error(`classification ${classification.input} has no matching element capture id`);
  }
  const elementInputs = report.classifications.filter(
    (classification) =>
      classification.element !== undefined && classification.element.kind !== "file",
  ).length;
  process.stdout.write(
    `generated/elements: ${fixtureFiles.length} captures (${elementIds.size} element captures), ` +
      `${report.classifications.length} classifications (${elementInputs} element), ` +
      `${report.findings.length} findings\n`,
  );
}

export async function main(outDirOverride?: string): Promise<void> {
  const outDir = outDirOverride ?? process.argv[2] ?? defaultOutDir;
  const report = await recordFixtureRun();
  hoistCaptures(outDir);
  formatFixture(outDir);
  await verifyFixture(outDir, report);
}

// Usage: bun scripts/build-fixture.ts [outDir] — the positional overrides the fixture dir (the
// determinism test runs two full processes into temp dirs and compares bytes). A fresh process per
// run is the contract: the engine keeps module-level grammar state, so a second lint() in the same
// process can discover a different inventory — never exercise this builder by importing it twice.
if (import.meta.main) await main();
