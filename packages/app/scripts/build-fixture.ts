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
 * classifiers the same way); the model, question compilation, state shapes, and report writing are
 * all real. The engine's own per-run entropy is sealed inside this script, not in packages/sdk:
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
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaultRules as defaultSpecs } from "@jint/defaults";
import {
  collectReport,
  compileRule,
  createClassifier,
  lint,
  renderJson,
  recordSummary,
  recordRunManifest,
  recordRunReport,
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
  // is_name_purposeful 0.25 -> error (less_than 0.3); the defect-pole noul: low P(good) is bad.
  is_name_purposeful: 0.25,
  // the rest sit inside the healthy band of their handles; will_error_lose_cause 0.5 -> warn
  // (greater_than 0.4), is_readable score 2 -> warn (score map: 0,1 pass; 2 warn; 3 error).
  is_function_srp: 0.5,
  will_error_lose_cause: 0.5,
  is_vocabulary_consistent: 0.9,
  is_naming_convention_consistent: 0.9,
  is_filename_fitting: 0.3,
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
 * Per-score-rule answer distributions, strict wire shape. is_cognitively_complex splits its mass
 * between the distant levels 0 and 2 while answering 2 - a bimodal distribution (is_readable is no
 * longer measured on these elements; its row stays for the designed shape).
 */
const SCORE_PROBABILITIES: Record<string, Record<string, number>> = {
  is_cognitively_complex: { "0": 0.45, "1": 0.1, "2": 0.45 },
  is_readable: { "0": 0.05, "1": 0.1, "2": 0.8, "3": 0.05 },
};

/**
 * Generic fallback distribution for a score rule the table does not name: 4 levels, mass 0.8 on the
 * answered level, the rest split - the wire requires the full record (SCORE_ANSWER_SCHEMA)
 * whichever rule asks, and the defaults' score-kind set moves.
 */
function centeredScore(value: number): Record<string, number> {
  const answered = Math.min(3, Math.max(0, Math.round(value)));
  const rest = Number(((1 - 0.8) / 3).toFixed(3));
  return { "0": rest, "1": rest, "2": rest, "3": rest, [String(answered)]: 0.8 };
}

/** Fake transport: answers the way POST /v1/systemone would, with fixed per-rule values. */
function stubFetch(): NonNullable<ClassifierConfig["fetch"]> {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      questions: Record<string, { type?: "noul" | "score" }>;
    };
    const answers: Record<string, unknown> = {};
    for (const [key, q] of Object.entries(body.questions)) {
      // element questions are keyed by bare rule name; file questions "<rule> in <id>"
      const rule = key.split(" in ")[0]!;
      const value = VALUES[rule] ?? (q.type === "score" ? 1 : 0.9);
      answers[key] =
        q.type === "score"
          ? {
              type: "score",
              score: value,
              // the wire requires the distribution (SCORE_ANSWER_SCHEMA); the table names the
              // designed shapes, the fallback covers score rules the table has not met yet
              probabilities: SCORE_PROBABILITIES[rule] ?? centeredScore(value),
              // the response check requires the level texts echoed back (SCORE_ANSWER_SCHEMA)
              legend: Object.fromEntries(
                ((q.criteria as string[] | undefined) ?? []).map((text, i) => [String(i), text]),
              ),
            }
          : { type: "noul", noul: value };
    }
    return new Response(
      JSON.stringify({
        model: "jev-fixture",
        answers,
        usage: { input_tokens: 100, output_tokens: 10 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}

/**
 * The baseline compiled from the defaults package through the sdk's public seam — the same compile
 * packages/cli/src/baseline.ts performs. defaultConfig is NOT on the sdk surface (it is a
 * cli/baseline concept), so the script builds the configless config itself.
 */
const baseline: Record<string, Rule> = Object.fromEntries(
  defaultSpecs.map((spec) => {
    const rule = compileRule(spec as never, "@jint/defaults");
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

export async function main(outDirOverride?: string): Promise<void> {
  const outDir = outDirOverride ?? process.argv[2] ?? defaultOutDir;
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  // activate recording BEFORE the first classifier call; point it at our staging root
  process.env.JINT_RUNS_DIR = stagingDir;
  process.env.TYPESAFE_API_KEY = "fixture-key";

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
        classifier: createClassifier({ apiKey: "fixture-key", fetch: stubFetch() }),
      }),
    );
  } finally {
    crypto.randomUUID = realRandomUUID;
  }

  // the engine's own writers persist report + manifest next to the captures recording already
  // wrote. The report's run pointer and the manifest's wall-clock fields carry per-run entropy —
  // replace them with the sentinels before anything hits disk.
  report.run.id = SENTINEL_RUN_ID;
  report.run.dir = SENTINEL_RUN_DIR;
  recordRunReport(renderJson(report));
  recordRunManifest({
    configPath: "fixtures/sources/elements",
    cwd: SENTINEL_CWD,
    argv: ["bun", "fixtures:gen"],
    ts: SENTINEL_TS,
    handles: Object.fromEntries(
      config.rules.flatMap((r) => (r.handleData ? [[r.name, r.handleData] as const] : [])),
    ),
  });

  // hoist <staging>/<runid>/* -> outDir/, deterministically: the recorder's <unixts>- filename
  // prefix and the per-record ts/durationMs are per-run entropy, so each capture is rewritten with
  // the sentinels and hoisted under its stripped name (the -<n> suffixes that disambiguate multiple
  // captures per source file stay). Manifest gets the same treatment for durationMs.
  const summary = recordSummary();
  if (summary === null || summary.count === 0)
    throw new Error("recording wrote no captures; generator is broken");
  // JINT_RUNS_DIR names the runs dir ITSELF (741b1dd's split): captures land at
  // <stagingDir>/<runId>, not <stagingDir>/runs/<runId>
  // The SDK mints one recorder client per classifier seam, and each recordRequests call re-stamps
  // the run id — so one lint can split its captures across several <stagingDir>/<runId>/ dirs (a
  // stub this fast usually lands them in one millisecond, but that is luck, not contract). Hoist
  // EVERY numeric run dir (the staging root is rm'd at entry, so all of them are ours) and rebuild
  // capture names deterministically: the recorder's <unixts>- stamp AND its -<n> collision suffixes
  // are both timing artifacts (existsSync races across concurrent requests), so both are stripped
  // and the -<n> suffixes are re-assigned by content order. Names stay path-keyed + suffixed —
  // multiple captures per source file remain unambiguous, and nothing resolves a capture by its
  // run-id prefix (the API serves the dir; nothing parses the stamp back out).
  const runDirs = readdirSync(stagingDir)
    .filter((n) => /^\d+$/.test(n))
    .sort();
  if (runDirs.length === 0) throw new Error(`no record run dirs under ${stagingDir}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  interface StagedCapture {
    base: string;
    raw: string;
    // content with the wall-clock fields stripped: raw bytes carry per-run ts and durationMs, and
    // ordering on those would assign the -<n> suffixes differently per run
    key: string;
    json: Record<string, unknown> | null;
  }
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
        // recordRunManifest stamps durationMs internally; seal it after the write. Its ts is the
        // sentinel the builder already passed, so it needs no stripping.
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
    json.ts = SENTINEL_TS;
    json.durationMs = 0;
    writeFileSync(join(outDir, name), JSON.stringify(json, null, 2) + "\n");
  }
  rmSync(stagingDir, { recursive: true, force: true });

  // the committed fixture is oxfmt-formatted (short arrays collapse, e.g. the handles map), and
  // JSON.stringify does not speak that dialect — format the hoisted tree so builder output IS the
  // committed bytes, determinism test included.
  const fmt = Bun.spawnSync(["bunx", "oxfmt", outDir], { cwd: appRoot });
  if (fmt.exitCode !== 0) throw new Error("oxfmt failed on the generated fixture");

  // --- verification ---------------------------------------------------------
  // element captures carry a uuid id (the recorder's top-level field: the id travels in a header,
  // never in the state); every element measurement's input suffix is one of those ids (identity propagated capture -> report). Also no input is a positional L-span.
  const elementIds = new Set<string>();
  const files = readdirSync(outDir).filter((f) => f.endsWith(".json"));
  const read = async (f: string) =>
    JSON.parse(await Bun.file(join(outDir, f)).text()) as {
      id?: unknown;
      request?: { state?: { source?: string } };
    };
  for (const f of files) {
    if (f === "report.json" || f === "manifest.json") continue;
    const cap = await read(f);
    if (cap.request?.state?.source !== undefined) {
      const id = cap.id;
      if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id))
        throw new Error(`element capture ${f} lacks a uuid id: ${String(id)}`);
      elementIds.add(id);
    }
  }
  for (const m of report.measurements) {
    if (m.input.includes("#L")) throw new Error(`positional input leaked: ${m.input}`);
    if (m.element === undefined)
      throw new Error(`measurement ${m.input} lacks the element projection`);
    if (m.element.kind === "file") continue;
    const suffix = m.input.split("#")[1];
    if (suffix === undefined || !elementIds.has(suffix))
      throw new Error(`measurement ${m.input} has no matching element capture id`);
  }
  const elementInputs = report.measurements.filter(
    (m) => m.element !== undefined && m.element.kind !== "file",
  ).length;
  process.stdout.write(
    `generated/elements: ${files.length} captures (${elementIds.size} element captures), ` +
      `${report.measurements.length} measurements (${elementInputs} element), ` +
      `${report.findings.length} findings\n`,
  );
}

// Usage: bun scripts/build-fixture.ts [outDir] — the positional overrides the fixture dir (the
// determinism test runs two full processes into temp dirs and compares bytes). A fresh process per
// run is the contract: the engine keeps module-level grammar state, so a second lint() in the same
// process can discover a different inventory — never exercise this builder by importing it twice.
if (import.meta.main) await main();
