import { expect, test } from "bun:test";
import { decompose } from "./walk.ts";

// A file's walk costs time proportional to its size. Containment, hiding and comment attachment
// each look at the spans still open at a position, not at every span in the file, so four times
// the functions costs about four times the time; a scan of every span costs sixteen.

function sourceOf(functions: number): string {
  return Array.from(
    { length: functions },
    (_, i) => `// note ${i}\nfunction f${i}(a: number) {\n  const x = a + ${i};\n  return x;\n}\n`,
  ).join("");
}

async function timeOf(functions: number): Promise<number> {
  const source = sourceOf(functions);
  const start = performance.now();
  const inventory = await decompose(source, "typescript");
  expect(inventory.definitions).toHaveLength(functions);
  return performance.now() - start;
}

test("walking four times the functions takes under eight times as long", async () => {
  await timeOf(500);
  const small = Math.min(await timeOf(5000), await timeOf(5000));
  const large = await timeOf(20000);
  expect(large / small).toBeLessThan(8);
}, 120_000);
