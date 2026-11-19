import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// jint asks System One through its own client (json-client.ts); the vendor's package is read for
// its types alone. A value import of it would pull its client, and its bugs, back in.

const SRC = join(import.meta.dir, "../..");
const VENDOR = /@typesafe-ai\/sdk/;

describe("typesafe sdk guard", () => {
  test("no file in the sdk package imports a value from the vendor's package", () => {
    const files = [...new Bun.Glob("**/*.{ts,tsx}").scanSync(SRC)].filter(
      (f) => !f.endsWith("typesafe-types-only.guard.test.ts"),
    );
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(SRC, file), "utf8");
      // a statement runs from its keyword to the module name; a type-only one is allowed
      for (const m of text.matchAll(
        /\b(import|export)\b[^;]*?from\s*["']([^"']+)["']|import\s*\(?\s*["']([^"']+)["']/g,
      )) {
        const spec = m[2] ?? m[3] ?? "";
        if (!VENDOR.test(spec)) continue;
        if (/^(import|export)\s+type\b/.test(m[0])) continue;
        offenders.push(`${file}: ${m[0].replace(/\s+/g, " ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
