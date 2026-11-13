import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMBEDDED } from "../packages/sdk/src/core/grammars/walk.ts";
import { WalkPool, WalkPoolBroken } from "../packages/sdk/src/core/walk-pool.ts";
import type { Unit } from "../packages/sdk/src/core/types.ts";

// A worker that crashes or hangs on a real file. The fixture workers are real worker threads that
// misbehave on purpose; the pool is the production one.

const fixturePath = (name: string) => join(import.meta.dir, "fixtures/walk-pool", `${name}.ts`);
const fixture = (name: string) => new URL(`./fixtures/walk-pool/${name}.ts`, import.meta.url).href;

function unitOf(path: string): Unit {
  return { kind: "file", state: { path, content: readFileSync(path, "utf8"), id: "f" } };
}

const pools: WalkPool[] = [];
function pool(options: ConstructorParameters<typeof WalkPool>[1]) {
  const p = new WalkPool(EMBEDDED, options);
  pools.push(p);
  return p;
}
afterEach(() => {
  for (const p of pools.splice(0)) p.close();
});

describe("walk pool failure", () => {
  const file = join(import.meta.dir, "walk-pool-failure.test.ts");

  test("a worker that crashes is replaced and the file is retried once in the fresh worker", async () => {
    rmSync(join(tmpdir(), "jint-walk-pool-crash-once"), { force: true });
    const workers = pool({ size: 1, workerUrl: fixture("crash-once") });
    const walked = await workers.walk(unitOf(file), {});
    expect(walked.failed).toBeNull();
    expect(walked.inventory.length).toBeGreaterThan(0);
    expect(workers.abandonedCount).toBe(1);
  });

  test("a file that kills two workers is marked failed and the next file still walks", async () => {
    const workers = pool({ size: 1, workerUrl: fixture("crash"), maxAbandoned: 10 });
    const walked = await workers.walk(unitOf(file), {});
    expect(walked.failed).toBe("parse failed");
    expect(String((walked.failedCause as Error).message)).toContain("worker");
    expect(workers.abandonedCount).toBe(2);
  });

  test("a worker that hangs is abandoned at the timeout, never awaited, and the file fails", async () => {
    const workers = pool({
      size: 1,
      workerUrl: fixture("hang"),
      fileTimeoutMs: 300,
      maxAbandoned: 10,
    });
    const started = performance.now();
    const walked = await workers.walk(unitOf(file), {});
    expect(walked.failed).toBe("parse failed");
    expect(String((walked.failedCause as Error).message)).toContain("within 300ms");
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(workers.abandonedCount).toBe(2);
  });

  // The hang is a wasm loop, which Bun's terminate() cannot stop: the thread keeps spinning and
  // keeps the process alive until the caller ends it.
  test("a process with a wasm-hung worker stays alive on its own and ends when the caller exits", async () => {
    const run = (mode: string) =>
      Bun.spawn(["bun", fixturePath("hang-run"), mode], { stdout: "pipe", stderr: "pipe" });
    const [idle, exiting] = [run("idle"), run("exit")];
    const out = await new Response(exiting.stdout).text();
    expect(out).toContain("done parse failed abandoned=2");
    expect(await exiting.exited).toBe(0);
    await Bun.sleep(1_000);
    expect(idle.exitCode).toBeNull();
    idle.kill("SIGKILL");
    await idle.exited;
  }, 20_000);

  test("a pool past its abandoned limit stops serving so the caller can walk in-process", async () => {
    const workers = pool({ size: 1, workerUrl: fixture("crash"), maxAbandoned: 1 });
    expect((await workers.walk(unitOf(file), {})).failed).toBe("parse failed");
    await expect(workers.walk(unitOf(file), {})).rejects.toBeInstanceOf(WalkPoolBroken);
  });
});

const THREADS = "/proc/self/task";

function sourceFiles(): string[] {
  return readdirSync(join(import.meta.dir, "../packages/sdk/src/core/grammars"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(import.meta.dir, "../packages/sdk/src/core/grammars", name));
}

// The thread count once it holds the same value across two samples 100 ms apart.
async function stableThreadCount(): Promise<number> {
  let last = -1;
  let steady = 0;
  for (let sample = 0; sample < 40 && steady < 2; sample++) {
    await Bun.sleep(100);
    const count = readdirSync(THREADS).length;
    steady = count === last ? steady + 1 : 0;
    last = count;
  }
  return last;
}

// The runtime keeps helper threads it started for the first workers; a leak shows as growth.
describe("walk pool lifetime", () => {
  const settledThreads = async (): Promise<number> => {
    const workers = pool({ size: 4 });
    await Promise.all(sourceFiles().map((file) => workers.walk(unitOf(file), {})));
    workers.close();
    return stableThreadCount();
  };

  test.skipIf(!existsSync(THREADS))(
    "closed pools leave no growing set of threads",
    async () => {
      const first = await settledThreads();
      await settledThreads();
      // helper threads wander by a few; a leaked pool of 4 adds 4 per round
      expect(await settledThreads()).toBeLessThanOrEqual(first + 3);
    },
    30_000,
  );
});
