/**
 * Regenerates two checked-in generated artifacts from source:
 *
 * - Jint.schema.json from CONFIG_SCHEMA (packages/sdk/src/config/load.ts)
 * - Docs/rules.mdx from the default rule specs (packages/defaults/src/index.ts)
 *
 * Run after any config-schema or default-spec change: bun run schema (wired into bun run validate).
 * Both emitted files are checked in so editors resolve "$schema" without running jint and docs stay
 * browsable, and CI diffs them against this output to catch drift — generated means never stale.
 */

import { writeFileSync } from "node:fs";
import { defaultRuleSpecs } from "@jint/defaults";
import { CONFIG_SCHEMA } from "@jint/sdk";

const GENERATION_NOTE =
  "GENERATED FILE — do not edit. Regenerate with: bun run schema (scripts/generate-schema.ts, from src/config/load.ts CONFIG_SCHEMA).";

const schema = { $comment: GENERATION_NOTE, ...CONFIG_SCHEMA };
const schemaOut = new URL("../jint.schema.json", import.meta.url).pathname;
writeFileSync(schemaOut, JSON.stringify(schema, null, 2) + "\n");
// Match the repo formatter so `bun run schema` output is stable under `bun run lint`.
Bun.spawnSync(["bunx", "oxfmt", schemaOut]);
process.stdout.write("wrote " + schemaOut + "\n");

const mdxOut = new URL("../docs/rules.mdx", import.meta.url).pathname;
const frontmatter =
  "---\n" +
  "title: Rules\n" +
  "description: The default rule set, rendered from the specs. Generated - do not edit.\n" +
  "---\n\n";
const body = [
  frontmatter,
  "# Default rules\n\n",
  "Rendered verbatim from the spec package (@jint/defaults). Instructions are the yes/no question " +
    "the classifier answers per element; criteria pins what each answer means; the target is the " +
    "element role the rule judges; the handle turns readings into findings. Editing any of these in " +
    "the specs is a recalibration event. Regenerate: `bun run schema`.\n\n",
];
for (const spec of Object.values(defaultRuleSpecs)) {
  const isChoice = spec.kind === "choice";
  body.push(`## \`${spec.name}\`\n\n`);
  body.push(`| kind | target | handle |\n|---|---|---|\n`);
  const handle = isChoice
    ? `score map: ${spec.handle.map.join(" → ")}`
    : Object.entries(spec.handle)
        .map(([level, op]) => {
          const [opName, threshold] = Object.entries(op as Record<string, number>)[0]!;
          return `${level} ${opName.replace(/_/g, " ")} ${threshold}`;
        })
        .join(", ");
  body.push(`| ${isChoice ? "choice" : "noul"} | ${spec.target} | ${handle} |\n\n`);
  body.push(`**Instructions.** ${spec.instructions}\n\n`);
  if (isChoice) {
    spec.criteria.forEach((criterion, i) => body.push(`**Score ${i}.** ${criterion}\n\n`));
  } else {
    body.push(`**True.** ${spec.criteria.true}\n\n`);
    body.push(`**False.** ${spec.criteria.false}\n\n`);
  }
}
writeFileSync(mdxOut, body.join("") + "\n");
process.stdout.write("wrote " + mdxOut + "\n");
