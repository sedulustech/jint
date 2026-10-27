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
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const CLI_SRC = "packages/cli/src/cli.ts";

const ROOT = join(import.meta.dir, "..", "..");

/**
 * The scratch runs store for this test process — the JINT_RUNS_DIR the preload and this helper
 * point at. Pid-scoped so parallel workers never share one store (run dirs are unix timestamps; two
 * writers would collide).
 */
export const RUNS_DIR = join(ROOT, "tmp", `provider-test-runs-${process.pid}`);

export interface RunCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** `{ open: true }` is a pipe held open and never written: a caller that never closes stdin. */
export type StdinPayload = string | Uint8Array | { file: string } | { open: true };

export interface RunCliOptions {
  /** Extra env on top of the inherited process env; wins over the JINT_RUNS_DIR scratch default. */
  env?: Record<string, string | undefined>;
  cwd?: string;
  bin?: string;
  timeout?: number;
  /** Piped stdin: a string, raw bytes (null separators, invalid UTF-8), or a file to stream. */
  stdin?: StdinPayload;
}

function stdinValue(payload: StdinPayload | undefined) {
  if (payload === undefined) return "ignore";
  if (typeof payload === "object" && "open" in payload) return "pipe";
  if (typeof payload === "object" && "file" in payload) return Bun.file(payload.file);
  if (payload instanceof Uint8Array) return new Blob([payload]).stream();
  return new Blob([payload]).stream();
}

function childEnv(extra?: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...process.env, JINT_RUNS_DIR: RUNS_DIR, ...extra };
}

/** Test-only env key naming a System One server to point the run at; consumed by runCli, never sent. */
const MOCK_URL = "MOCK_PROVIDER_URL";

/**
 * The env for a run answered by a System One server at `baseUrl` (the mock provider, or a dead
 * address): the key the systemone provider reads, plus the URL, which runCli turns into provider
 * data - a `providers` override in a wrapper config - rather than passing it through the
 * environment.
 */
export const mockWire = (baseUrl: string): Record<string, string> => ({
  JINT_TYPESAFE_API_KEY: "test-key",
  [MOCK_URL]: baseUrl,
});

/** The env for a run with the systemone provider and no key. */
export const NO_KEY_WIRE = { JINT_PROVIDER: "systemone", JINT_TYPESAFE_API_KEY: "" };

let wrapperCount = 0;

/**
 * A config that is the config the run would load (--config, else the one discovered in cwd, else
 * none) plus the systemone provider at `url`. Written beside that config, so its scope base is
 * unchanged, and excluded from the walk under its own name; the caller removes it.
 */
function wrapConfig(args: string[], cwd: string, url: string): { args: string[]; file: string } {
  const at = args.indexOf("--config");
  const given = at >= 0 ? resolve(cwd, args[at + 1]!) : undefined;
  const found = ["jint.config.ts", "jint.config.json"]
    .map((name) => join(cwd, name))
    .find((path) => existsSync(path));
  const base = given ?? found;
  const dir = base === undefined ? join(RUNS_DIR, "..", "mock-configs") : dirname(base);
  mkdirSync(dir, { recursive: true });
  const name = `.jint-mock-${process.pid}-${wrapperCount++}.config.ts`;
  const file = join(dir, name);
  writeFileSync(
    file,
    [
      base === undefined ? "const base = {};" : `import base from ${JSON.stringify(base)};`,
      "export default {",
      "  ...base,",
      `  exclude: [...((base as { exclude?: string[] }).exclude ?? []), ${JSON.stringify(name)}],`,
      '  provider: "systemone",',
      `  providers: { systemone: { url: ${JSON.stringify(url)} } },`,
      "};",
      "",
    ].join("\n"),
  );
  const rest = at >= 0 ? args.filter((_, i) => i !== at && i !== at + 1) : args;
  // right after the verb: appended, it would land behind a `--` that ends flag parsing
  return { args: [rest[0]!, "--config", file, ...rest.slice(1)], file };
}

export async function runCli(args: string[], opts: RunCliOptions = {}): Promise<RunCliResult> {
  const { [MOCK_URL]: mockUrl, ...env } = opts.env ?? {};
  const wrapped = mockUrl === undefined ? undefined : wrapConfig(args, opts.cwd ?? ROOT, mockUrl);
  try {
    return await spawnCli(wrapped?.args ?? args, { ...opts, env });
  } finally {
    if (wrapped !== undefined) rmSync(wrapped.file, { force: true });
  }
}

async function spawnCli(args: string[], opts: RunCliOptions): Promise<RunCliResult> {
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
  const code = await proc.exited;
  // the held pipe closes only after the child is gone, so the child never saw an end of stdin
  if (opts.stdin !== undefined && typeof opts.stdin === "object" && "open" in opts.stdin) {
    (proc.stdin as { end(): void }).end();
  }
  return { code, stdout, stderr };
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
  const code = await proc.exited;
  // the held pipe closes only after the child is gone, so the child never saw an end of stdin
  if (opts.stdin !== undefined && typeof opts.stdin === "object" && "open" in opts.stdin) {
    (proc.stdin as { end(): void }).end();
  }
  return { code, stdout, stderr };
}
