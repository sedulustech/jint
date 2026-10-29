// The recorder is always-on (no off switch), so test processes redirect the runs store to
// scratch instead of disabling it. Spawned CLI children do NOT inherit this — bun captures the
// environment at process startup, so preload mutations do not cross spawns; tests/helpers/cli.ts
// is what points spawned jint runs at the scratch store via an explicit JINT_RUNS_DIR.
import { CACHE_DIR, RUNS_DIR } from "./helpers/cli.ts";

process.env.JINT_RUNS_DIR = RUNS_DIR;
// the answer cache is on by default: in-process tests must not read or fill the real ~/.jint/cache
process.env.JINT_CACHE_DIR = `${CACHE_DIR}/in-process`;
