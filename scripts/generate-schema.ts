/**
 * Regenerates two checked-in generated artifacts from source:
 *
 * - Jint.schema.json from CONFIG_SCHEMA (packages/sdk/src/config/load.ts)
 * - Docs/rules.md from the default rules (packages/defaults/src/index.ts)
 *
 * Run after any config-schema or default-rule change: bun run schema (wired into bun run validate).
 * Both emitted files are checked in so editors resolve "$schema" without running jint and docs stay
 * browsable, and CI diffs them against this output to catch drift — generated means never stale.
 */

import { writeFileSync } from "node:fs";
import { defaultRules as defaultSpecs } from "@jint/defaults";
import { CONFIG_SCHEMA } from "@jint/sdk";

const GENERATION_NOTE =
  "GENERATED FILE — do not edit. Regenerate with: bun run schema (scripts/generate-schema.ts, from src/config/load.ts CONFIG_SCHEMA).";

const schema = { $comment: GENERATION_NOTE, ...CONFIG_SCHEMA };
const schemaOut = new URL("../jint.schema.json", import.meta.url).pathname;
writeFileSync(schemaOut, JSON.stringify(schema, null, 2) + "\n");
// Match the repo formatter so `bun run schema` output is stable under `bun run lint`.
Bun.spawnSync(["bunx", "oxfmt", schemaOut]);
process.stdout.write("wrote " + schemaOut + "\n");

const mdxOut = new URL("../docs/rules.md", import.meta.url).pathname;
const frontmatter =
  "---\n" +
  "title: Rules\n" +
  "description: The default rule set, rendered from the default rules. Generated - do not edit.\n" +
  "---\n\n";
const body = [
  frontmatter,
  "# Default rules\n\n",
  "Rendered verbatim from the spec package (@jint/defaults). Instructions are the yes/no question " +
    "the classifier answers per element; criteria pins what each answer means; the target is the " +
    "element role the rule judges; the handle turns readings into findings. Editing any of these in " +
    "the specs is a recalibration event. Regenerate: `bun run schema`.\n\n",
];
for (const spec of defaultSpecs) {
  const isChoice = spec.kind === "choice";
  body.push(`## \`${spec.name}\`\n\n`);
  const handle = isChoice
    ? `score map: ${spec.handle.map.join(" → ")}`
    : Object.entries(spec.handle)
        .map(([level, op]) => {
          const [opName, threshold] = Object.entries(op as Record<string, number>)[0]!;
          return `${level} ${opName.replace(/_/g, " ")} ${threshold}`;
        })
        .concat(
          // tier messages are author guidance for the finding consumer; quote them after thresholds
          Object.entries(spec.handle)
            .filter(([, op]) => typeof (op as { message?: string }).message === "string")
            .map(([, op]) => `"${(op as { message: string }).message}"`),
        )
        .join(", ");
  // oxfmt-aligned tables: pad every cell to the column's widest entry, dash-rule included
  const cells = [
    ["kind", isChoice ? "choice" : "noul"],
    // targets render joined: the explicit list form (the defaults' union) is one cell
    ["target", Array.isArray(spec.target) ? spec.target.join(", ") : String(spec.target)],
    ["handle", handle],
  ];
  const width = cells.map(([header, value]) => Math.max(header.length, value.length));
  const row = (values: string[]) =>
    `| ${values.map((v, i) => v.padEnd(width[i]!)).join(" | ")} |\n`;
  body.push(row(cells.map(([h]) => h)));
  body.push(`| ${width.map((w) => "-".repeat(w)).join(" | ")} |\n`);
  body.push(row(cells.map(([, v]) => v)) + "\n");
  body.push(`**Instructions.** ${spec.instructions}\n\n`);
  if (isChoice) {
    spec.criteria.forEach((criterion, i) => body.push(`**Score ${i}.** ${criterion}\n\n`));
  } else {
    body.push(`**True.** ${spec.criteria.true}\n\n`);
    body.push(`**False.** ${spec.criteria.false}\n\n`);
  }
}
writeFileSync(mdxOut, body.join("").replace(/\n+$/, "\n"));
process.stdout.write("wrote " + mdxOut + "\n");

// ---------------------------------------------------------------------------
// Skills (skills/jint-follow, skills/jint-author) - the two agent-facing docs,
// fully generated. The follower gets severity + fixer message only; the creator
// gets the rule schema and the calibration ritual. Skills never reference each
// other; shared invocation detail defers to the CLI's --help.
// ---------------------------------------------------------------------------

// The rule-schema material, rendered from the same sources as the schema and
// the specs, so the authoring doc cannot rot behind the wire shape.
const ruleItems = (CONFIG_SCHEMA.properties.rules as { items: { anyOf: unknown[] } }).items;
const ruleObject = ruleItems.anyOf.find(
  (v) => (v as { anyOf?: unknown[] }).anyOf !== undefined,
) as { anyOf: Array<{ properties: Record<string, { description?: string; const?: string }> }> };
const props = ruleObject.anyOf[0]!.properties;
const FALLBACK_DESCRIPTIONS: Record<string, string> = {
  name: "The rule id: findings join back to it; config rules later in the array override same-named earlier ones.",
  criteria:
    "The two-sided contract: noul carries {true, false}; choice carries an ordered rubric (score 0..N). The defect side decides the handle direction.",
  target:
    "What the rule judges: files = the whole unit; functions/definitions/comments/imports = elements derived from the parse.",
  handle:
    "When readings surface as findings; the shape depends on kind (the two descriptions below).",
  include:
    "Rule scoping: glob list over walked paths; replaces any fragment-level scope wholesale. Config exclude stays absolute.",
  exclude:
    "Rule scoping: glob list over walked paths; replaces any fragment-level scope wholesale. Config exclude stays absolute.",
};
const propRows = Object.entries(props)
  .map(
    ([key, meta]) =>
      "| `" +
      key +
      "` | " +
      (meta.description ?? FALLBACK_DESCRIPTIONS[key] ?? meta.const ?? "") +
      " |",
  )
  .join("\n");
const noulHandle =
  "Noul handle (noul rules only): per-threshold comparison operators declare the direction - warn is the wider region, error the strictly narrower one (same direction, ordered toward the defect: greater warn < greater error, or less warn > less error). silent_band [lo, hi] keeps raw-p readings inside it silent (must be ordered, must not cover the whole scale, must not contain a threshold value); absent = everything surfaces.";
const scoreHandle =
  "Score handler (choice rules only): one level per criteria entry, indexed by score 0..N. Direction is expressed by the map itself (high-bad: [pass, pass, warn, error]; high-good: [error, warn, pass, pass]). The length MUST equal the criteria count and at least one level must be non-pass.";
const callbackHandle =
  'Callback custom rules (TS config only): handle may be a (results, ctx) => decisions function, one decision per reading: { severity: "error" | "warn" | null, message? }. Null severity is silent (measurement only). message is an instruction to the caller fixing the finding; severity says whether, message says how - it renders beneath the finding line and rides the report as finding.message.';
const example = {
  $schema: "./jint.schema.json",
  rules: [
    defaultSpecs.find((spec) => spec.name === "is_greppable"),
    defaultSpecs.find((spec) => spec.name === "is_cognitively_complex"),
  ],
};
const ruleSchemaBlock = [
  "| key | meaning |",
  "| --- | --- |",
  propRows,
  "",
  "Handles, both kinds - direction lives in the handle, never in prose:",
  "",
  "- **noul** (yes/no): `" + noulHandle + "`",
  "- **choice** (scored rubric): `" + scoreHandle + "`",
  "",
  callbackHandle,
].join("\n");

// The fixer-message table, derived from the same handle message fields the
// findings renderer reads - never hand-copied, so the follower skill cannot
// drift from the messages it is told to execute.
type FixerMessage = { rule: string; severity: string; message: string };
const fixerMessages: FixerMessage[] = [];
for (const spec of defaultSpecs) {
  if (spec.kind === "choice") {
    for (const entry of spec.handle.map) {
      if (typeof entry !== "string" && typeof entry.message === "string") {
        fixerMessages.push({ rule: spec.name, severity: entry.level, message: entry.message });
      }
    }
  } else {
    for (const [level, op] of Object.entries(spec.handle)) {
      const message = (op as { message?: string }).message;
      if (typeof message === "string") {
        fixerMessages.push({ rule: spec.name, severity: level, message });
      }
    }
  }
}
const fixerTable = [
  "| rule | severity | fixer message |",
  "| --- | --- | --- |",
  ...fixerMessages.map((m) => `| \`${m.rule}\` | ${m.severity} | ${m.message} |`),
].join("\n");

// --- skills/jint-follow/SKILL.md -------------------------------------------
const followOut = new URL("../skills/jint-follow/SKILL.md", import.meta.url).pathname;
const follow = [
  "---",
  "name: jint-follow",
  "description: >",
  "  Run jint on a path and resolve its findings. Use when measuring code quality,",
  "  naming, or comments and fixing what jint flags. Triggers: jint, jev lint.",
  "---",
  "",
  "# jint - run it, fix what it flags",
  "",
  "jint measures code with AI-classifier judgments and prints findings: a severity",
  "and, for most rules, a fixer message that states the exact fix.",
  "",
  "## Run it",
  "",
  "Install (either): npm `npm install -g @sedulus/jint@rc`, or",
  "`curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/main/install.sh | bash`.",
  "`TYPESAFE_API_KEY` must be in the environment. Every flag, including output",
  "formats and scoping, lives in `jint --help` - the tool's own contract, not",
  "duplicated here.",
  "",
  "A whole path: `jint run <path>`. One element: `jint run <path>@L<line> --rule",
  "<rule>`. The CLI echoes which element an @L selector captured - verify that",
  "element is the one you mean before fixing anything.",
  "",
  "Anchors are PRE-EDIT. `@L<n>` names the line the run saw, not the line that",
  "exists now. After any edit, re-anchor: grep the declaration, re-run.",
  "",
  "## Read the findings",
  "",
  "A finding carries a severity and a fixer message. Severity + message is the",
  "whole actionable surface - not the schema, not thresholds, not score numbers.",
  "",
  "The canonical fixer message per rule (rendered from the same tables the CLI",
  "uses, so this cannot drift from the messages you will see):",
  "",
  fixerTable,
  "",
  "A finding without a row above carries no fixer message; the finding's own text",
  "is the instruction.",
  "",
  "## Spend",

  "Every run costs classifier spend. Measure the smallest surface that answers",
  "the question.",

  "- Fixing one finding: re-run scoped to that element (`path@L<line>`), not the",
  "  file, not the tree.",
  "- Working in one file: run that file, not the directory.",
  "- A full run is for discovering findings; scoped runs are for verifying a fix.",
  "## The fix loop",
  "",
  "1. Take a finding. Re-query just that unit:",
  "   `jint run <path>@L<line> --rule <rule>`. One query, one unit, one verdict.",
  "2. Read the element the CLI echoed. Verify it is the finding's target.",
  "3. Execute the fixer message EXACTLY. The message is canonical - do not",
  "   interpret, soften, or improve on it. Do not fork: no partial fix, no",
  "   rewording that leaves the flagged thing in place.",
  "4. Edit the source file itself. Captures and request dumps record what was",
  "   judged, not how the file is written now; their indentation is not source.",
  "5. Re-anchor at the current line and re-query to confirm the finding is gone.",
  "",
  "## Hard rules",
  "",
  "- Never edit rules, thresholds, the engine, or config to make a finding pass.",
  "- If you believe a finding is wrong, report it and stop. Do not work around it.",
  "- Do not read the schema, thresholds, or score numbers. Severity + message is",
  "  all you act on.",
  "",
].join("\n");
writeFileSync(followOut, follow);
Bun.spawnSync(["bunx", "oxfmt", followOut]);
process.stdout.write("wrote " + followOut + "\n");

// --- skills/jint-author/SKILL.md + REFERENCE.md -----------------------------
const authorOut = new URL("../skills/jint-author/SKILL.md", import.meta.url).pathname;
const author = [
  "---",
  "name: jint-author",
  "description: >",
  "  Author and calibrate jint rules: criteria, handles, fixer messages, and the",
  "  two-language calibration ritual for promoting a rule to the default set.",
  "  Triggers: rule calibration, jint rules.",
  "---",
  "",
  "# jint - author and calibrate rules",
  "",
  "jint measures code: rules in, findings out. A **rule** compiles to one question",
  "for **jev** (TypeSafe's System One classifier); each answer is a calibrated",
  "reading; a reading that crosses the rule's thresholds becomes a **finding**.",
  "",
  "## Rules are data",
  "",
  "Every rule (noul included) may carry `instructions`: the yes/no question the",
  "model answers, one sentence, stating the claim. The compiler always prepends a",
  'kind sentence ("This unit is a function definition.") to whatever you write, so',
  "never state the element kind yourself. Changing instructions is a recalibration",
  "event. Criteria pin what each answer means; for choice rules the ordered",
  "criteria list is the score legend (score 0..N).",
  "",
  ruleSchemaBlock,
  "",
  "A live config example, serialized from real default specs (always the current",
  "wire shape):",
  "",
  "```json",
  "AUTHOR_EXAMPLE_PLACEHOLDER",
  "```",
  "",
  "Worked examples and failure shapes: REFERENCE.md next to this file.",
  "",
  "## Fixer messages are decisive",
  "",
  "A handle tier's `message` is the instruction the fixing agent executes. Write",
  'it imperative and singular: "Remove this comment." One action, no forks, no',
  'alternatives - a forked message ("remove it, or better, rewrite the function")',
  "gives the agent a choice, and a choice is where fixes die.",
  "",
  "Measured: an agent briefed with extra rule taxonomy kept 34 error-tier",
  'comments; an agent briefed only with "follow the fixer messages" reached zero.',
  "The message is the intervention. Everything else is rationalization material.",
  "",
  "## The calibration ritual",
  "",
  "A rule is not promoted to the default set from one corpus:",
  "single-language calibration overfits that language's naming and structure",
  "conventions.",
  "",
  "- Probe on at least two languages: a healthy corpus plus defective fixtures",
  "  per language.",
  "- Document the healthy-max / defective-min gap for each language; thresholds",
  "  must sit inside every measured gap.",
  "- Validate that the rule's claim survives each language's conventions (naming",
  "  style, file/package layout), not only its syntax.",
  "- Defective fixtures are mandatory: a rule with no defective example is a",
  "  hypothesis, not a rule.",
  "",
  'AGENTS.md ("Adding defaults") is the authority for this ritual, including the',
  "precedent (is_filename_fitting, issue 006: TS probe 0.36/0.88, Go probe",
  "0.25/0.72). Defer to it; do not restate thresholds here.",
  "",
].join("\n");
writeFileSync(
  authorOut,
  author.replace("AUTHOR_EXAMPLE_PLACEHOLDER", JSON.stringify(example, null, 2)),
);
process.stdout.write("wrote " + authorOut + "\n");

// REFERENCE.md: the scenario depth (jev properties, live noul + choice examples,
// the criteria shape that fails). Generated so the examples cannot rot.
const referenceOut = new URL("../skills/jint-author/REFERENCE.md", import.meta.url).pathname;
const greppable = defaultSpecs.find((spec) => spec.name === "is_greppable")!;
const complex = defaultSpecs.find((spec) => spec.name === "is_cognitively_complex")!;
const specJson = (spec: unknown) => JSON.stringify(spec, null, 2);
const reference = [
  "# jint authoring - reference",
  "",
  "Generated - do not edit. Regenerate with: `bun run schema`.",
  "",
  "## What jev is (read before writing criteria)",
  "",
  "jev is a System One classifier, not a chat model: it returns calibrated",
  "probabilities (noul, 0..1) or rubric scores, no explanations. Key properties:",
  "",
  "- **0.5 is undecided, not medium.** A noul of 0.45 vs 0.55 is not a ranking.",
  "- **Calibrated middle matters.** Thresholds live in the 0.3-0.8 band; generic",
  "  LLMs quantize to 0/1 and are useless here (measured: gemini flash-lite).",
  "- **State shape changes readings.** One state x many questions is valid; the",
  "  matrix form (many states + many questions in one call) averages everything.",
  "  jint handles this for you - never stack elements into one state yourself.",
  "",
  "## Noul example: a two-sided criteria contract",
  "",
  "Rendered from the live default spec `${greppable.name}` (always the current",
  "wire shape):",
  "",
  "```json",
  specJson(greppable),
  "```",
  "",
  "Note the shape: `true` names the exact observable condition for yes, `false`",
  "for no, and both sides are exhaustive. The defect side decides the handle",
  "direction.",
  "",
  "## Choice example: the scored rubric",
  "",
  "Use a rubric when the property is graded, not yes/no. The instructions carry a",
  'scoping sentence ("do not score X here"); the ordered criteria are the score',
  "legend; levels are descriptions, not true/false. Rendered from the live spec",
  "`${complex.name}`:",
  "",
  "```json",
  specJson(complex),
  "```",
  "",
  "## The criteria shape that fails",
  "",
  "This shape reads reasonable and fails on a healthy corpus:",
  "",
  "```json",
  '  "rules": [',
  "    {",
  '      "name": "will_naming_drift",',
  '      "target": "definitions",',
  '      "criteria": {',
  '        "true": "The change introduces naming drift: the same concept is called by different names across the change.",',
  '        "false": "Naming is consistent."',
  "      },",
  '      "handle": { "warn": { "greater_than": 0.5 }, "error": { "greater_than": 0.7 } }',
  "    }",
  "  ]",
  "```",
  "",
  "It fails three ways: `false` is generic (name the exact observable condition),",
  "the claim spans multiple elements - the model compares against names it cannot",
  'see - and "drift" invites narrating quality instead of checking a condition.',
  "The fix is never thresholds; rewrite the criteria until they name an observable",
  "condition.",
  "",
].join("\n");
writeFileSync(referenceOut, reference);
Bun.spawnSync(["bunx", "oxfmt", authorOut, referenceOut]);
process.stdout.write("wrote " + referenceOut + "\n");
