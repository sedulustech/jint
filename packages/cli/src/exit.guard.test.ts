import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT, EXIT_CODES } from "./exit.ts";

/**
 * STRUCTURAL GUARD - exit codes live in one table (exit.ts). A bare numeric code in the CLI source
 * turns the table into a suggestion; this tripwire names the fix. Tests may pin literal codes: that
 * is the contract under test.
 */
const SRC = import.meta.dir;

/** A numeric code at the shapes an exit takes: `exit: 2`, `exit(2)`, `exitCode = 2`, `return 2;`. */
const BARE_EXIT: readonly RegExp[] = [
  /\bexit\s*:\s*\d/,
  /\bexit\s*\(\s*\d/,
  /\bexitCode\s*=\s*\d/,
  /\breturn\s+\d+\s*;/,
];

export function bareExitLines(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//") && BARE_EXIT.some((rx) => rx.test(line)));
}

describe("exit-code table guard", () => {
  test("no source file but exit.ts writes a bare numeric exit code", () => {
    const files = readdirSync(SRC).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "exit.ts",
    );
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((name) =>
      bareExitLines(readFileSync(join(SRC, name), "utf8")).map((line) => `${name}: ${line.trim()}`),
    );
    expect(offenders, "name a key of EXIT (src/exit.ts) instead of a number").toEqual([]);
  });

  test("planted negatives: each bare shape is flagged", () => {
    for (const line of [
      "return { exit: 2 };",
      "process.exit(1)",
      "process.exitCode = 3;",
      "return 4;",
    ]) {
      expect(bareExitLines(line), line).toHaveLength(1);
    }
    expect(bareExitLines("return { exit: EXIT.ok };")).toEqual([]);
  });

  test("the table documents every code once", () => {
    expect(EXIT_CODES.map((row) => row.code).sort()).toEqual(Object.values(EXIT).sort());
  });

  test("the CLI reference lists every row of the table", () => {
    const page = readFileSync(join(SRC, "..", "..", "..", "docs", "reference", "cli.md"), "utf8");
    for (const row of EXIT_CODES) expect(page).toContain(`### \`${row.code}\`\n\n${row.meaning}\n`);
  });
});
