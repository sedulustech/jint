/**
 * Shared CLI-run plumbing for the e2e suite. Every spawn funnels through here so the env policy
 * lives in exactly one place: recording is always on, so the helper points JEV_DIR at a scratch
 * store — tests must never write to the real ~/.jint/runs. A spawned CLI must get JEV_DIR
 * explicitly because bun captures the environment at process startup — the preload's JEV_DIR
 * mutation does NOT cross spawns; this helper is what keeps child jint runs out of the real store.
 *
 * Relative bin paths resolve against the repo root, so a per-test cwd (a tmp config dir, say)
 * cannot silently retarget the CLI.
 */
import { join } from "node:path";

export const CLI_SRC = "packages/cli/src/cli.ts";

const ROOT = join(import.meta.dir, "..", "..");

/**
 * The scratch runs store for this test process — the JEV_DIR the preload and this helper point at.
 * Pid-scoped so parallel workers never share one store (run dirs are unix timestamps; two writers
 * would collide).
 */
export const RUNS_DIR = join(ROOT, "tmp", `jev-test-runs-${process.pid}`);

export interface RunCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunCliOptions {
  /** Extra env on top of the inherited process env; wins over the JEV_DIR scratch default. */
  env?: Record<string, string | undefined>;
  cwd?: string;
  bin?: string;
  timeout?: number;
}

function childEnv(extra?: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...process.env, JEV_DIR: RUNS_DIR, ...extra };
}

export async function runCli(args: string[], opts: RunCliOptions = {}): Promise<RunCliResult> {
  const proc = Bun.spawn(["bun", join(ROOT, opts.bin ?? CLI_SRC), ...args], {
    cwd: opts.cwd ?? ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: childEnv(opts.env),
    timeout: opts.timeout,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

export function runCliSync(args: string[], opts: RunCliOptions = {}): RunCliResult {
  const proc = Bun.spawnSync(["bun", join(ROOT, opts.bin ?? CLI_SRC), ...args], {
    cwd: opts.cwd ?? ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: childEnv(opts.env),
    timeout: opts.timeout,
  });
  return {
    code: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

/** Shell pipeline variant for stdin plumbing the CLI cannot receive through argv. */
export async function runShell(command: string, opts: RunCliOptions = {}): Promise<RunCliResult> {
  const proc = Bun.spawn(["/bin/bash", "-c", command], {
    cwd: opts.cwd ?? ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: childEnv(opts.env),
    timeout: opts.timeout,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}
