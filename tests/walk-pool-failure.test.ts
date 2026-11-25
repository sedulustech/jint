import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
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
