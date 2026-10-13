import { describe, test, expect } from "bun:test";
import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Resolve the repo root from this file's location (.oxlint/… → repo root). */
const ROOT = import.meta.dir.replace(/\/\.oxlint.*$/, "");

function lint(content: string, filename = "test.ts"): string {
  const dir = mkdtempSync(join(tmpdir(), "oxlint-test-"));
  try {
    writeFileSync(join(dir, filename), content);
    const cmd = `bunx --bun oxlint --config ${ROOT}/oxlint.config.ts ${dir} 2>&1`;
    try {
      return execSync(cmd, { cwd: ROOT, encoding: "utf-8", timeout: 15_000 });
    } catch (err) {
      // oxlint exits non-zero when any diagnostic fires; its report is on stdout.
      const output = (err as { stdout?: string }).stdout;
      if (typeof output === "string") return output;
      throw err;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function hasDiagnostic(output: string, message: string): boolean {
  return output.includes(`anti-slop(no-conditional-empty-object-spread): ${message}`);
}

describe("no-conditional-empty-object-spread", () => {
  test("pass: spread of a maybe-object variable", () => {
    const out = lint(`const extra = opts && opts.extra;\nconst merged = { ...extra, a: 1 };\n`);
    expect(hasDiagnostic(out, "conditionally spread")).toBe(false);
  });

  test("pass: plain spread", () => {
    const out = lint(`const base = { a: 1 };\nconst merged = { ...base };\n`);
    expect(hasDiagnostic(out, "conditionally spread")).toBe(false);
  });

  test("pass: array spread of logical expression", () => {
    const out = lint(`const flag = true;\nconst items = [...(flag && [{ a: 1 }])];\n`);
    expect(hasDiagnostic(out, "conditionally spread")).toBe(false);
  });

  test("pass: conditional spread of maybe-object variable", () => {
    const out = lint(
      `declare const extra: Record<string, number> | undefined;\nconst merged = { ...(extra && extra), a: 1 };\n`,
    );
    expect(hasDiagnostic(out, "conditionally spread")).toBe(false);
  });

  test("pass: ternary with object-literal alternate (covered by conditional branch)", () => {
    const out = lint(
      `declare const cond: boolean;\nconst merged = { ...(cond ? { a: 1 } : { a: 2 }) };\n`,
    );
    expect(hasDiagnostic(out, "conditionally spread")).toBe(false);
  });

  test("fail: logical AND with object literal", () => {
    const out = lint(`declare const cond: boolean;\nconst merged = { ...(cond && { a: 1 }) };\n`);
    expect(
      hasDiagnostic(
        out,
        "Do not conditionally spread an object literal with `&&`/`||`. Branch the whole object literal instead.",
      ),
    ).toBe(true);
  });

  test("fail: logical OR with object literal", () => {
    const out = lint(`declare const cond: boolean;\nconst merged = { ...(cond || { a: 1 }) };\n`);
    expect(
      hasDiagnostic(
        out,
        "Do not conditionally spread an object literal with `&&`/`||`. Branch the whole object literal instead.",
      ),
    ).toBe(true);
  });
});
