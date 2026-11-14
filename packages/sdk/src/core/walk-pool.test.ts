import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCustomGrammars, type GrammarRegistry } from "./grammars/grammars.ts";
import { EMBEDDED, languageOf } from "./grammars/walk.ts";
import { walkUnit } from "./rules/walk-unit.ts";
import { WalkPool, walkEach } from "./walk-pool.ts";
import type { Unit } from "./types.ts";

const SDK_SRC = join(import.meta.dir, "..");

function sourceFiles(dir: string, registry: GrammarRegistry = EMBEDDED): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && languageOf(registry, e.name) !== null)
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

function unitOf(path: string): Unit {
  return { kind: "file", state: { path, content: readFileSync(path, "utf8"), id: "f" } };
}

const pools: WalkPool[] = [];
function pool(registry: GrammarRegistry, options: ConstructorParameters<typeof WalkPool>[1]) {
  const p = new WalkPool(registry, options);
  pools.push(p);
  return p;
}
afterEach(() => {
  for (const p of pools.splice(0)) p.close();
});

describe("walk pool output", () => {
  test("every file of the sdk package walks to the same value in a worker as in-process", async () => {
    const units = sourceFiles(SDK_SRC).map(unitOf);
    expect(units.length).toBeGreaterThan(100);
    const workers = pool(EMBEDDED, { size: 3 });
    const pooled = await Promise.all(units.map((u) => workers.walk(u, {})));
    for (const [i, unit] of units.entries()) {
      const local = await walkUnit(unit, {});
      // strict: an undefined-valued key and a missing key differ
      expect(Bun.deepEquals(pooled[i], local, true), unit.state.path).toBe(true);
    }
    expect(workers.abandonedCount).toBe(0);
  });

  test("a custom grammar and its queries reach the workers through the registry value", async () => {
    const root = mkdtempSync(join(tmpdir(), "jint-pool-grammar-"));
    mkdirSync(join(root, "markdown"));
    const embedded = new URL("./grammars/embedded/markdown/", import.meta.url);
    for (const file of ["markdown.wasm"]) {
      writeFileSync(
        join(root, "markdown", file),
        new Uint8Array(await Bun.file(new URL(file, embedded)).arrayBuffer()),
      );
    }
    const scm = (await Bun.file(new URL("queries.scm", embedded)).text()) + "\n; user copy\n";
    writeFileSync(join(root, "markdown", "queries.scm"), scm);
    writeFileSync(join(root, "markdown", "extensions.json"), '[".md", ".usr"]');
    const registry = await loadCustomGrammars(root);
    const path = join(root, "note.usr");
    writeFileSync(path, "# Title\n\nA paragraph.\n\n## Part\n\nMore text.\n");
    const unit = unitOf(path);
    const workers = pool(registry, { size: 2 });
    const pooled = await workers.walk(unit, {});
    expect(pooled.derived?.provenance.source).toBe("user");
    expect(pooled.inventory.length).toBeGreaterThan(0);
    expect(Bun.deepEquals(pooled, await walkUnit(unit, { registry }), true)).toBe(true);
  });
});

describe("walkEach", () => {
  const unitNumber = (i: number): Unit => ({
    kind: "file",
    state: { path: `f${i}.py`, content: `def f${i}():\n    pass\n`, id: "f" },
  });

  test("yields each file's walk in source order, the same value as walking it in-process", async () => {
    const units = Array.from({ length: 30 }, (_, i) => unitNumber(i));
    const seen: string[] = [];
    for await (const { unit, walked } of walkEach(units, EMBEDDED, {}, { workers: 2 })) {
      seen.push(unit.kind === "file" ? unit.state.path : "");
      expect(walked).toEqual(await walkUnit(unit, { registry: EMBEDDED }));
    }
    expect(seen).toEqual(units.map((u) => (u.kind === "file" ? u.state.path : "")));
  });

  async function pulledBeforeFirstResult(limits: {
    inFlightFiles?: number;
    inFlightBytes?: number;
  }): Promise<{ pulled: number; total: number }> {
    let pulled = 0;
    async function* source(): AsyncGenerator<Unit> {
      for (let i = 0; i < 200; i++) {
        pulled++;
        yield unitNumber(i);
      }
    }
    const walks = walkEach(source(), EMBEDDED, {}, { workers: 2, ...limits });
    await walks.next();
    const atFirst = pulled;
    let total = 1;
    for await (const _ of walks) total++;
    return { pulled: atFirst, total };
  }

  test("pulls only as many files ahead as it may keep in flight, however long the source", async () => {
    const { pulled, total } = await pulledBeforeFirstResult({ inFlightFiles: 10 });
    expect(pulled).toBeLessThanOrEqual(11);
    expect(total).toBe(200);
  });

  test("a file's source bytes count against the read-ahead, so a few large files keep it short", async () => {
    // each unit is about 25 bytes: 60 bytes in flight allows three files
    const { pulled, total } = await pulledBeforeFirstResult({ inFlightBytes: 60 });
    expect(pulled).toBeLessThanOrEqual(4);
    expect(total).toBe(200);
  });
});
