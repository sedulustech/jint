/**
 * Regenerates jint.schema.json from CONFIG_SCHEMA (src/config/load.ts). Run after any config schema
 * change: bun run schema. The emitted file is checked in so editors resolve "$schema" without
 * running jint, and CI can diff it against this output to catch drift.
 */

import { writeFileSync } from "node:fs";
import { CONFIG_SCHEMA } from "../src/config/load.ts";

const GENERATION_NOTE =
  "GENERATED FILE — do not edit. Regenerate with: bun run schema (scripts/generate-schema.ts, from src/config/load.ts CONFIG_SCHEMA).";

const schema = { $comment: GENERATION_NOTE, ...CONFIG_SCHEMA };
const out = new URL("../jint.schema.json", import.meta.url).pathname;
writeFileSync(out, JSON.stringify(schema, null, 2) + "\n");
// Match the repo formatter so `bun run schema` output is stable under `bun run lint`.
Bun.spawnSync(["bunx", "oxfmt", out]);
process.stdout.write("wrote " + out + "\n");
