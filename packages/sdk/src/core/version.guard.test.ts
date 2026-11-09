import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// One place names the version: VERSION in version.ts. A second reader of the package version could
// print a different one, as report.json did before this test.
const ROOTS = ["../../../cli/src", "../../../sdk/src"];

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !path.endsWith(".d.ts"))
      yield path;
  }
}

test("no source reads the package version but version.ts", () => {
  const readers: string[] = [];
  for (const root of ROOTS) {
    for (const file of files(join(import.meta.dir, root))) {
      if (file.endsWith("core/version.ts")) continue;
      const source = readFileSync(file, "utf8");
      if (/\bpackage\.json["']/.test(source) && /\.version\b/.test(source)) readers.push(file);
    }
  }
  expect(readers).toEqual([]);
});
