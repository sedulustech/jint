/**
 * BUILDER 2 of 2 — the REAL-PIPELINE generated case fixture (generated/elements). Runs the actual
 * engine end to end (fixture-pipeline design, tmp/designs/fixture-pipeline.md): walk.ts ->
 * classify.ts -> jev tap captures -> the engine's report/manifest writers. No hand-built capture
 * shapes — the fixture is what the engine actually emits, so format changes (like uuid element ids)
 * are absorbed by regenerating.
 *
 * Usage: bun run fixtures:gen (from packages/app)
 *
 * Source dir : tests/fixtures/sources/elements/ (real TS files, checked in) output run :
 * tests/fixtures/generated/elements/ (captures + report.json + manifest.json, committed; the API
 * serves it as the nested run "generated/elements")
 *
 * Determinism: the only stubbed piece is the transport — a fetch that answers every question with a
 * fixed per-rule value (the engine's own lint tests stub classifiers the same way). The model,
 * question compilation, state shapes, uuid minting, and report writing are all real. Captures carry
 * wall-clock timestamps and per-run uuids, so regeneration is not byte-identical — tests assert
 * shapes and relationships, never uuids.
 */
import { mkdirSync, readdirSync, rmSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  collectReport,
  createClassifier,
  defaultConfig,
  lint,
  renderJson,
  requestTapSummary,
  requestTapWriteManifest,
  requestTapWriteReport,
  type ClassifierConfig,
} from "@jint/sdk";

const appRoot = resolve(import.meta.dir, "..");
const sourceDir = resolve(appRoot, "tests/fixtures/sources/elements");
const outDir = resolve(appRoot, "tests/fixtures/generated/elements");
// staging under tmp (gitignored); the tap writes to <base>/<runid>/ and we hoist that one dir
const stagingDir = resolve(appRoot, "../..", "tmp/fixtures-gen");

/**
 * Deterministic per-rule answers (p-space noul values; is_readable and is_cognitively_complex are
 * scores — 0-3 and 0-2 rubrics). Chosen to exercise severity variety against the default handle
 * thresholds: one error (is_name_purposeful 0.25 < error_at 0.3), one warn (will_error_lose_cause
 * 0.5 > warn_at 0.4, is_readable score 2), the rest inside their healthy band.
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
  // scored rubric since the 2026-09-29 swap: 0 = Easy, inside the healthy band (level 0 pass)
  is_cognitively_complex: 0,
  is_readable: 2,
};

/** Per-score-rule answer distributions: mass on the answered level, strict wire shape. */
const SCORE_PROBABILITIES: Record<string, Record<string, number>> = {
  is_cognitively_complex: { "0": 0.9, "1": 0.05, "2": 0.05 },
  is_readable: { "0": 0.05, "1": 0.1, "2": 0.8, "3": 0.05 },
};

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
              // the wire requires the distribution (SCORE_ANSWER_SCHEMA); mass on the answered level
              probabilities: SCORE_PROBABILITIES[rule]!,
              confidence: 0.8,
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

async function main(): Promise<void> {
  mkdirSync(stagingDir, { recursive: true });
  // activate the tap BEFORE the first classifier call; point it at our staging root
  process.env.JEV_DEBUG_REQUEST_LOCATION = stagingDir;
  process.env.TYPESAFE_API_KEY = "fixture-key";

  const config = { ...defaultConfig(), exclude: [] };
  const report = await collectReport(
    lint({
      config,
      input: sourceDir,
      inputType: "dir",
      classifier: createClassifier({ apiKey: "fixture-key", fetch: stubFetch() }),
    }),
  );

  // the engine's own writers persist report + manifest next to the captures the tap already wrote
  requestTapWriteReport(renderJson(report));
  requestTapWriteManifest({
    configPath: "fixtures/sources/elements",
    cwd: appRoot,
    argv: ["bun", "fixtures:gen"],
    ts: new Date().toISOString(),
    handles: Object.fromEntries(
      config.rules.flatMap((r) => (r.handleData ? [[r.name, r.handleData] as const] : [])),
    ),
  });

  // hoist <staging>/<runid>/* -> outDir/
  const summary = requestTapSummary();
  if (summary === null || summary.count === 0)
    throw new Error("request tap wrote no captures; generator is broken");
  const runDirs = readdirSync(stagingDir).filter((n) => /^\d+$/.test(n));
  if (runDirs.length === 0) throw new Error(`no tap run dir under ${stagingDir}`);
  const newest = runDirs.map((n) => Number(n)).sort((a, b) => b - a)[0]!;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(join(stagingDir, String(newest)))) {
    renameSync(join(stagingDir, String(newest), f), join(outDir, f));
  }
  rmSync(join(stagingDir, String(newest)), { recursive: true, force: true });

  // --- verification ---------------------------------------------------------
  // element captures carry a uuid state.id; every element measurement's input suffix is one of
  // those ids (identity propagated capture -> report). Also no input is a positional L-span.
  const elementIds = new Set<string>();
  const files = readdirSync(outDir).filter((f) => f.endsWith(".json"));
  const read = async (f: string) =>
    JSON.parse(await Bun.file(join(outDir, f)).text()) as {
      request?: { state?: { source?: string; id?: unknown } };
    };
  for (const f of files) {
    if (f === "report.json" || f === "manifest.json") continue;
    const cap = await read(f);
    if (cap.request?.state?.source !== undefined) {
      const id = cap.request.state.id;
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

await main();
