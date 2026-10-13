/**
 * The one CLI spawn helper: async Bun.spawn with argv arrays (never a shell - quoting is a test bug
 * class), both output pipes drained concurrently (no pipe-buffer deadlock), and opt-in stdin as a
 * string, raw bytes, or a file path. Kill ceiling defaults to 60s: every run boots a whole bun
 * process and on a loaded CI runner a spawn alone can burn seconds before the CLI's own work
 * starts
 *
 * - The runner also runs the vendored retry chain on purpose in the NO_SERVICE tests (~2s per
 *   request), so a tight ceiling kills healthy runs.
 */
import { join } from "node:path";

export const CLI_SRC = "packages/cli/src/cli.ts";

const ROOT = join(import.meta.dir, "..", "..");

/**
 * The scratch runs store for this test process — the JINT_DIR the preload and this helper point at.
 * Pid-scoped so parallel workers never share one store (run dirs are unix timestamps; two writers
 * would collide).
 */
export const RUNS_DIR = join(ROOT, "tmp", `jev-test-runs-${process.pid}`);

export interface RunCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type StdinPayload = string | Uint8Array | { file: string };

export interface RunCliOptions {
  /** Extra env on top of the inherited process env; wins over the JINT_DIR scratch default. */
  env?: Record<string, string | undefined>;
  cwd?: string;
  bin?: string;
  timeout?: number;
  /** Piped stdin: a string, raw bytes (null separators, invalid UTF-8), or a file to stream. */
  stdin?: StdinPayload;
}

function stdinValue(payload: StdinPayload | undefined) {
  if (payload === undefined) return "ignore";
  if (typeof payload === "object" && "file" in payload) return Bun.file(payload.file);
  if (payload instanceof Uint8Array) return new Blob([payload]).stream();
  return new Blob([payload]).stream();
}

function childEnv(extra?: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...process.env, JINT_DIR: RUNS_DIR, ...extra };
}

export async function runCli(args: string[], opts: RunCliOptions = {}): Promise<RunCliResult> {
  const proc = Bun.spawn(["bun", join(ROOT, opts.bin ?? CLI_SRC), ...args], {
    cwd: opts.cwd ?? ROOT,
    stdout: "pipe",
    stderr: "pipe",
    stdin: stdinValue(opts.stdin),
    env: childEnv(opts.env),
    timeout: opts.timeout,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

/**
 * The pty escape hatch - the ONE shell spawn left. Needed only where the test requires a pseudo-TTY
 * on stdin (the CLI must refuse to read a terminal); no argv spawn can provide one. Never use this
 * for ordinary stdin: pipe the payload through runCli({ stdin }) instead.
 */
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
