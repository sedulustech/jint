// The recorder is always-on (no off switch), so test processes redirect the runs store to
// scratch instead of disabling it. Spawned CLI children do NOT inherit this — bun captures the
// environment at process startup, so preload mutations do not cross spawns; tests/helpers/cli.ts
// is what points spawned jint runs at the scratch store via an explicit JEV_DIR.
import { RUNS_DIR } from "./helpers/cli.ts";

process.env.JEV_DIR = RUNS_DIR;
