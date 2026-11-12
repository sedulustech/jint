/**
 * The real `jint ui serve`, spawned: the helper reads the url the process prints on stderr, so a
 * test talks to the server the way a user's browser does. The caller stops it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_SRC } from "./cli.ts";
import { scratchDir } from "./dir.ts";

export interface ServeSeed {
  store: string;
  dist: string;
}

export interface Served {
  url: string;
  stop: () => void;
}

/** A scratch store holding one run, and a dist directory holding an index.html. */
export function seedStore(): { seed: ServeSeed; dir: string } {
  const dir = scratchDir("ui-serve");
  const run = join(dir, "runs", "100");
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "manifest.json"), JSON.stringify({ configPath: "/c.json" }));
  writeFileSync(join(run, "1700000000001-files.json"), "{}");
  const dist = join(dir, "dist");
  mkdirSync(dist);
  writeFileSync(join(dist, "index.html"), "<html><body>jint ui</body></html>");
  return { seed: { store: join(dir, "runs"), dist }, dir };
}

/**
 * Starts `jint ui serve` over the seed and resolves with its url once it prints one. A process that
 * exits first rejects with what it printed.
 */
export async function startServe(
  seed: ServeSeed,
  env: Record<string, string | undefined> = {},
): Promise<Served> {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "..", "..", CLI_SRC), "ui", "serve"], {
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, JINT_RUNS_DIR: seed.store, JINT_UI_DIST: seed.dist, ...env },
  });
  const decoder = new TextDecoder();
  const reader = proc.stderr.getReader();
  let text = "";
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
    const url = /jint: ui -> (\S+)/.exec(text)?.[1];
    if (url !== undefined) return { url, stop: () => proc.kill() };
  }
  proc.kill();
  throw new Error(`serve printed no url: ${text}`);
}
