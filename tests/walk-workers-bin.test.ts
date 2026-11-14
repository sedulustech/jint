import { beforeAll, describe, expect, jest, test } from "bun:test";
import { join } from "node:path";
import { mockDecisionsWire, RUNS_DIR } from "./helpers/cli.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";
import { startMockDecisions } from "./helpers/mock-provider.ts";

// The compiled binary parses on worker threads: its embedded worker module starts from the path
// the build defines, and the embedded grammars load inside it. Every run starts from a directory
// other than the repo, so nothing resolves by the checkout.

jest.setTimeout(120_000);

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "jint");
const FILE = await Bun.file(join(ROOT, "packages/sdk/src/core/scope.ts")).text();

beforeAll(async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    // the walk needs the binary's commands, not its embedded UI
    env: { ...process.env, JINT_BUILD_NO_UI: "1" },
  });
  const [out, err] = await Promise.all([
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ]);
  if ((await build.exited) !== 0) throw new Error(`build failed: ${out}${err}`);
});

async function corpus(files: number): Promise<{ root: string; config: string }> {
  const root = scratchDir("jint-walk-workers");
  for (let i = 0; i < files; i++) await Bun.write(join(root, "src", `f${i}.ts`), FILE);
  const config = join(root, "jint.config.json");
  await Bun.write(
    config,
    JSON.stringify({ rules: { include: ["**/*.ts"], use: ["is_greppable"] } }),
  );
  return { root, config };
}

function spawnBin(root: string, config: string, baseUrl: string, workers: number) {
  return Bun.spawn(
    [BIN, "run", join(root, "src"), "--config", config, "--json", "--rule", "is_greppable"],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...mockDecisionsWire(baseUrl),
        JINT_RUNS_DIR: RUNS_DIR,
        JINT_CACHE_DIR: join(root, "cache", String(workers)),
        JINT_WALK_WORKERS: String(workers),
      },
    },
  );
}

describe("walk workers in the compiled binary", () => {
  test("a run on two worker threads reports what one thread reports, and the process exits", async () => {
    const { root, config } = await corpus(70);
    const provider = startMockDecisions();
    try {
      const results: { code: number; stdout: string; stderr: string }[] = [];
      for (const workers of [1, 2]) {
        const proc = spawnBin(root, config, provider.baseUrl, workers);
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        results.push({ code: await proc.exited, stdout, stderr });
      }
      const [one, two] = results as [(typeof results)[number], (typeof results)[number]];
      expect([0, 1]).toContain(two.code);
      expect(two.code).toBe(one.code);
      // a worker that did not start leaves the run on the main thread and says so
      expect(two.stderr).not.toContain("walk workers failed");
      const report = (text: string) => {
        const parsed = JSON.parse(text);
        // run identity and timing differ per run; ids are fresh uuids
        delete parsed.run;
        return JSON.stringify(parsed)
          .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "id")
          .replaceAll('"cached":true,', ""); // identical files race for the answer cache
      };
      expect(report(two.stdout)).toBe(report(one.stdout));
      expect(JSON.parse(two.stdout).classifications.length).toBeGreaterThan(70);
    } finally {
      provider.stop();
      rmScratchTree(root);
    }
  });

  test("SIGINT during the walk ends the process at once with workers alive", async () => {
    const { root, config } = await corpus(400);
    const provider = startMockDecisions();
    try {
      const proc = spawnBin(root, config, provider.baseUrl, 4);
      void new Response(proc.stdout).text();
      void new Response(proc.stderr).text();
      await Bun.sleep(700);
      const started = performance.now();
      proc.kill("SIGINT");
      expect(await proc.exited).toBe(130);
      expect(performance.now() - started).toBeLessThan(3_000);
    } finally {
      provider.stop();
      rmScratchTree(root);
    }
  });
});
