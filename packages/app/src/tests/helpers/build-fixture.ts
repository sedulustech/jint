/**
 * Regenerates the checked-in test fixtures. Deterministic: the fixtures are SYNTHESIZED (not
 * sampled from a live dump), so re-running this on any machine produces identical files.
 *
 * Usage: bun tests/helpers/build-fixture.ts
 *
 * Fixtures/run-a/ 10 captures + report.json. Covers the STATES, not a corpus:
 *
 * - 3 rules: a normal name, a greedy-parser breaker ("has_nothing in mind"), a distinct name
 * - Borderline (0.45-0.55), high (>0.9), low (<0.25) max-p answers
 * - One capture with multiple questions (several rules on one element)
 * - One capture with NO questions (rules []) that must stay visible unfiltered
 * - One elements-tier capture (state.source) among the files-tier ones (state.content)
 *   fixtures/run-b/ 3 captures, NO report.json (the disabled report-toggle contract)
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// packages/app
const root = resolve(import.meta.dir, "../..");
const outA = join(root, "tests/fixtures/run-a");
const configsDir = join(root, "tests/fixtures/configs");
const outB = join(root, "tests/fixtures/run-b");

const RULE_NORMAL = "is_name_purposeful";
// breaks the greedy /^(.*) in (.+)$/ key parse on purpose
const RULE_GREEDY = "has_nothing in mind";
const RULE_OTHER = "will_comment_drift";
// score-kind rule: value indexes the map (ok/warn/error); exercises the score handle path
const RULE_SCORE = "will_error_lose_cause";
// the acceptance shape: documents-a-noul rule, defect pole FALSE - a HIGH noul (0.8) is GOOD
const RULE_DOC = "is_noul_documented";

const CODE_A = "export function alpha(x: number): number {\n  return x + 1;\n}\n";
const CODE_B = "export const beta = (s: string): string => s.trim();\n";
const CODE_C = "// gamma keeps a comment\nexport function gamma() {\n  return null;\n}\n";

let stamp = 1700000000000;
const nextStamp = () => ++stamp;

interface Q {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}
function q(rule: string): Q {
  return {
    type: "noul",
    instructions: `Judge ${rule}.`,
    criteria: { true: "holds", false: "does not hold" },
  };
}
function capture(opts: {
  kind: "files" | "elements";
  path: string;
  code: string;
  questions: Record<string, unknown>;
  answers: Record<string, { type: string; noul: number }>;
}) {
  const state =
    opts.kind === "files"
      ? { path: opts.path, content: opts.code, id: "L1-L5" }
      : { path: opts.path, source: opts.code, id: "E1" };
  return {
    ts: new Date(stamp).toISOString(),
    url: "https://api.typesafe.ai/v1/systemone",
    request: { state, questions: opts.questions, model: "jev-1.13.0" },
    status: 200,
    response: {
      model: "jev-1.13.0",
      answers: opts.answers,
      usage: { input_tokens: 100, output_tokens: 10 },
    },
  };
}
const key = (rule: string, id: string) => `${rule} in ${id}`;

const CAPS: { file: string; cap: ReturnType<typeof capture> }[] = [];
const MEAS: { rule: string; input: string; value: number }[] = [];
const add = (
  name: string,
  kind: "files" | "elements",
  path: string,
  code: string,
  answers: Record<string, number>,
  extraQuestions: string[] = [],
) => {
  const id = kind === "elements" ? "E1" : "L1-L5";
  const rules = Object.keys(answers);
  const questions: Record<string, unknown> = {};
  for (const r of [...rules, ...extraQuestions]) questions[key(r, id)] = q(r);
  const ans: Record<string, { type: string; noul: number }> = {};
  for (const [r, v] of Object.entries(answers)) {
    ans[key(r, id)] = { type: "noul", noul: v };
    // canonical name straight from the generator
    MEAS.push({ rule: r, input: path, value: v });
  }
  CAPS.push({
    file: `${nextStamp()}-${kind}-${name}.json`,
    cap: capture({ kind, path, code, questions, answers: ans }),
  });
};

// state edges: borderline, high max-p, low max-p
add("borderline.ts", "files", "src/borderline.ts", CODE_A, { [RULE_NORMAL]: 0.5 });
add("high.ts", "files", "src/high.ts", CODE_A, { [RULE_NORMAL]: 0.92 });
add("low.ts", "files", "src/low.ts", CODE_A, { [RULE_NORMAL]: 0.08 });
add("near-mid.ts", "files", "src/near-mid.ts", CODE_A, { [RULE_NORMAL]: 0.51 });
// multi-question + elements tier; greedy-breaker rule; low/high edges; no-questions edge
add("multi.ts", "elements", "src/multi.tsx", CODE_B, { [RULE_NORMAL]: 0.7, [RULE_GREEDY]: 0.3 });
add("greedy.ts", "files", "src/greedy.ts", CODE_B, { [RULE_GREEDY]: 0.8 });
add("greedy-low.ts", "files", "src/greedy-low.ts", CODE_B, { [RULE_GREEDY]: 0.2 });
add("other-high.ts", "files", "src/other-high.ts", CODE_C, { [RULE_OTHER]: 0.95 });
add("other-borderline.ts", "elements", "src/other-b.tsx", CODE_C, { [RULE_OTHER]: 0.45 });
// score map index 3 -> error
add("score.ts", "files", "src/score.ts", CODE_A, { [RULE_SCORE]: 3 });
// high noul under fires_when:false: the unit IS documented = pass; must render neutral, never error
add("documented.ts", "files", "src/documented.ts", CODE_A, { [RULE_DOC]: 0.8 });
add("no-questions.ts", "files", "src/none.ts", CODE_A, {});

// clean regeneration: stale captures from older generator versions must not survive
for (const dir of [outA, outB]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}
for (const { file, cap } of CAPS) {
  writeFileSync(join(outA, file), JSON.stringify(cap, null, 2) + "\n");
  if (bSelected(file)) writeFileSync(join(outB, file), JSON.stringify(cap, null, 2) + "\n");
}
function bSelected(file: string) {
  // run-b: first three captures, deterministic
  return CAPS.slice(0, 3).some((c) => c.file === file);
}

// configs/sample.json: the tiny config the fixture run "ran with" (manifest.configPath target)
mkdirSync(configsDir, { recursive: true });
writeFileSync(
  join(configsDir, "sample.json"),
  JSON.stringify({ $schema: "jint.schema.json", input: "src/", exclude: [] }, null, 2) + "\n",
);

// run-a manifest.json: REQUIRED for the run to be first-class in the picker
writeFileSync(
  join(outA, "manifest.json"),
  JSON.stringify(
    {
      // Synthetic absolute path: manifests record absolute paths, but a checked-in fixture must
      // stay machine-independent - the UI only reads the basename anyway.
      configPath: "/opt/jint-fixture/configs/sample.json",
      handles: {
        // is_name_purposeful claims a GOOD property: the defect direction is LOW p
        [RULE_NORMAL]: { warn: { less_than: 0.55 }, error: { less_than: 0.4 } },
        [RULE_GREEDY]: { warn: { greater_than: 0.6 }, silent_band: [0.75, 0.85] },
        [RULE_OTHER]: { warn: { greater_than: 0.6 }, error: { greater_than: 0.9 } },
        [RULE_SCORE]: { map: ["pass", "pass", "warn", "error"] },
        // the acceptance shape: a documented-claim rule - HIGH noul (0.8) passes
        [RULE_DOC]: { warn: { less_than: 0.4 }, error: { less_than: 0.3 } },
      },
      cwd: root,
      argv: ["bun", "tests/helpers/build-fixture.ts"],
      ts: new Date(0).toISOString(),
    },
    null,
    2,
  ) + "\n",
);

// run-a report.json: one measurement per question, two findings (one with a #span input)
const measurements = MEAS.flatMap((m) => ({
  ...m,
  stage: m.input.endsWith(".tsx") ? "element" : "file",
}));
// agrees with the handle projection: defect pole of 0.5 under fires_when:false is 0.5 > warn_at 0.45
const findings = [
  { rule: RULE_NORMAL, input: "src/borderline.ts", value: 0.5, severity: "warn" },
  {
    rule: RULE_OTHER,
    input: "src/other-high.ts#L1-L3",
    value: 0.95,
    severity: "error",
    location: {
      input: "src/other-high.ts#L1-L3",
      span: { start: { line: 1, column: 0 }, end: { line: 3, column: 2 } },
    },
  },
];
const report = {
  tool: "jint",
  format: "jint-report/v1",
  version: "0.1.0",
  measurements,
  findings,
  errors: [],
  notes: ["fixture run"],
};
writeFileSync(join(outA, "report.json"), JSON.stringify(report, null, 2) + "\n");

process.stdout.write(
  `run-a: ${CAPS.length} captures + report.json (${measurements.length} measurements, ${findings.length} findings)`,
);
process.stdout.write(`run-b: 3 captures, no manifest (legacy - hidden by the picker)`);
