// Walks one file in a pool whose worker hangs in wasm, prints "done", then ends the way the
// caller chose: "exit" ends the process explicitly (as the CLI does), "idle" leaves it to end itself.
import { readFileSync } from "node:fs";
import { EMBEDDED } from "../../../packages/sdk/src/core/grammars/walk.ts";
import { WalkPool, abandonedWalkWorkers } from "../../../packages/sdk/src/core/walk-pool.ts";

const path = new URL(import.meta.url).pathname;
const pool = new WalkPool(EMBEDDED, {
  size: 1,
  workerUrl: new URL("./hang.ts", import.meta.url).href,
  fileTimeoutMs: 200,
  maxAbandoned: 10,
});
const walked = await pool.walk(
  { kind: "file", state: { path, content: readFileSync(path, "utf8"), id: "f" } },
  {},
);
pool.close();
console.log(`done ${walked.failed} abandoned=${abandonedWalkWorkers()}`);
if (process.argv[2] === "exit" && abandonedWalkWorkers() > 0) process.exit(0);
