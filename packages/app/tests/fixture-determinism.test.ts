import { afterEach, expect, test } from "bun:test";
/**
 * The generated fixture's whole point (scripts/build-fixture.ts header): regeneration is
 * byte-identical — same file names, same bytes, nothing excluded. Two full builder PROCESSES (the
 * fixtures:gen contract) into separate temp dirs must produce exactly the same tree.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
const script = new URL("../scripts/build-fixture.ts", import.meta.url).pathname;

async function gen(): Promise<string> {
  const dir = join(mkdtempSync(join(tmpdir(), "jint-fixture-")), "elements");
  dirs.push(dir);
  const proc = Bun.spawnSync(["bun", script, dir], { cwd: join(import.meta.dir, "..") });
  if (proc.exitCode !== 0) {
    throw new Error(`builder failed: ${new TextDecoder().decode(proc.stderr)}`);
  }
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("generated fixture is byte-identical across runs", async () => {
  const a = await gen();
  const b = await gen();

  const namesA = readdirSync(a).sort();
  const namesB = readdirSync(b).sort();
  // stable names: no per-run unixts prefix, no wall-clock anything in a file name
  expect(namesA).toEqual(namesB);
  expect(namesA.filter((n) => /^\d+-/.test(n))).toEqual([]);
  expect(namesA).toContain("report.json");
  expect(namesA).toContain("manifest.json");

  // nothing excluded: every file, byte for byte
  for (const name of namesA) {
    const bytesA = readFileSync(join(a, name));
    const bytesB = readFileSync(join(b, name));
    expect(bytesA.equals(bytesB), `${name} differs across runs`).toBe(true);
  }

  // the sentinel timestamps landed
  for (const name of namesA.filter((n) => n !== "report.json")) {
    const parsed = JSON.parse(readFileSync(join(a, name), "utf8")) as { ts?: string };
    if (parsed.ts !== undefined) expect(parsed.ts).toBe("1970-01-01T00:00:00.000Z");
  }
});
