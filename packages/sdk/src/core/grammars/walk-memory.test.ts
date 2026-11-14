import { expect, test } from "bun:test";
import { decompose } from "./walk.ts";

// The parser's wasm memory is one heap per process, capped at 2 GiB. Each tree stays in it until
// it is freed, so a walk that keeps its trees aborts the instance partway through a large run.

const source = Array.from(
  { length: 3000 },
  (_, i) => `function f${i}(a: number) { return a + ${i}; }`,
).join("\n");

test("walking the same large file many times does not grow the parser's memory", async () => {
  await decompose(source, "typescript");
  const before = process.memoryUsage().arrayBuffers;
  for (let i = 0; i < 8; i++) await decompose(source, "typescript");
  const grown = process.memoryUsage().arrayBuffers - before;
  expect(grown).toBeLessThan(30 * 1024 * 1024);
}, 60_000);

test("a source the grammar cannot parse cleanly is freed too", async () => {
  const broken = `${source}\nfunction ((( {`;
  await decompose(broken, "typescript");
  const before = process.memoryUsage().arrayBuffers;
  for (let i = 0; i < 8; i++) {
    const inventory = await decompose(broken, "typescript");
    expect(inventory.hasError).toBe(true);
  }
  expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(30 * 1024 * 1024);
}, 60_000);
