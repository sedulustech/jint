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

import { readFileSync, writeFileSync } from "node:fs";
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
        .join(", ");
  // oxfmt-aligned tables: pad every cell to the column's widest entry, dash-rule included
  const cells = [
    ["kind", isChoice ? "choice" : "noul"],
    ["target", spec.target],
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

// SKILL.md's rule-schema block: the config surface and a live example, rendered from the same
// sources as the schema and the specs, so the authoring doc cannot rot behind the wire shape.
const skillOut = new URL("../SKILL.md", import.meta.url).pathname;
const BEGIN = "<!-- rule-schema:begin (generated - do not edit; bun run schema) -->";
const END = "<!-- rule-schema:end -->";
const skill = readFileSync(skillOut, "utf8");
const begin = skill.indexOf(BEGIN);
const end = skill.indexOf(END);
if (begin === -1 || end === -1) throw new Error("SKILL.md rule-schema markers missing");
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
const example = {
  $schema: "./jint.schema.json",
  rules: [
    defaultSpecs.find((spec) => spec.name === "is_greppable"),
    defaultSpecs.find((spec) => spec.name === "is_cognitively_complex"),
  ],
};
const block = [
  "| key | meaning |",
  "| --- | --- |",
  propRows,
  "",
  "Handles, both kinds - direction lives in the handle, never in prose:",
  "",
  "- **noul** (yes/no): `" + noulHandle + "`",
  "- **choice** (scored rubric): `" + scoreHandle + "`",
  "",
  'Callback custom rules (TS config only): handle may be a (results, ctx) => decisions function, one decision per reading: { severity: "error" | "warn" | null, message? }. Null severity is silent (measurement only). message is an instruction to the caller fixing the finding; severity says whether, message says how - it renders beneath the finding line and rides the report as finding.message.',
  "",
  "A live config example, serialized from real default specs (always the current wire shape):",
  "",
  "```json",
  JSON.stringify(example, null, 2),
  "```",
  "",
].join("\n");
const afterRuleBlock =
  skill.slice(0, begin + BEGIN.length) + "\n" + block + "\n" + skill.slice(end);

// SKILL.md's run-dir block: run-store literacy — the fix loop, the capture join, and the
// quoting rule. Generated so the workflow text cannot drift behind the report's run field.
const RUN_BEGIN = "<!-- run-dir:begin (generated - do not edit; bun run schema) -->";
const RUN_END = "<!-- run-dir:end -->";
const runBegin = afterRuleBlock.indexOf(RUN_BEGIN);
const runEnd = afterRuleBlock.indexOf(RUN_END);
if (runBegin === -1 || runEnd === -1) throw new Error("SKILL.md run-dir markers missing");
const runDirBlock = [
  "## The run dir",
  "",
  "The run dir is the record of what the model saw. Read it before you probe.",
  "",
  "### The fix loop",
  "",
  "1. Take a finding. Re-query just that unit: `jint <path>@L<line> --rule <rule>`. One query,",
  "   one unit, one verdict. No full re-run.",
  "2. Anchors are PRE-EDIT. `@L<n>` names the line the run saw, not the line that exists now.",
  "3. After any edit, re-anchor at the CURRENT line. Grep the declaration. Then re-query.",
  "",
  "### Element inventory without the CLI",
  "",
  "Every run records its captures in a run dir. Find it on stderr after a run, or read the",
  "report's top-level `run` field: `run.dir` is the dir, `run.id` is its name. The dir holds",
  "capture files named `<unixts>-elements-<file>.json` - one file per request, one request per",
  "element. The envelope is `{request, response}`; the judged text is `request.state.source`,",
  "with `request.state.id` and `request.state.path`. A capture carries no span: spans live in the",
  "report (`measurements[].element.span`, `findings[].location.span`), joined by input id. Read",
  "these instead of probing anchors with live queries.",
  "",
  "### The join: finding to judged text",
  "",
  "A report finding names its element in `findings[].input`. That string is `<path>#<id>`,",
  "where `<id>` equals the capture's `state.id`. Split on `#` and match the tail. The match",
  "recovers the exact text the model judged.",
  "",
  "### Quote source from the file, never from the capture",
  "",
  "Captures tell you WHAT was judged. The file tells you HOW it is written now. Capture JSON is",
  "pretty-printed; its indentation is not source. Edit from the file. A pasted capture indent is",
  "a wasted edit.",
  "",
  "### Paths and scoping",
  "",
  "An explicit path overrides config scoping. That is by design. A piped list must respect the",
  "config's `exclude`: filter before the pipe, e.g.",
  "`git diff --name-only | grep -vE '\\.test\\.ts$|^tests/' | jint paths -`.",
  "",
  "### The binary goes stale",
  "",
  "The repo-root `jint` is a compiled artifact. Merges do not rebuild it. `bun run build`",
  "refreshes `packages/cli/dist/cli.js`, not the root binary. Run `node packages/cli/dist/cli.js`",
  "after a merge, or recompile the root binary before trusting it. A stale binary reports old",
  "behavior as if it were current.",
  "",
].join("\n");
writeFileSync(
  skillOut,
  afterRuleBlock.slice(0, runBegin + RUN_BEGIN.length) +
    "\n" +
    runDirBlock +
    "\n" +
    afterRuleBlock.slice(runEnd),
);
// Match the repo formatter so `bun run schema` output is stable under `bun run lint`.
Bun.spawnSync(["bunx", "oxfmt", skillOut]);
process.stdout.write("wrote " + skillOut + "\n");
