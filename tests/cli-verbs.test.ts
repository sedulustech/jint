import { describe, expect, jest, test } from "bun:test";
import { join } from "node:path";
import { capture } from "../packages/sdk/src/index.ts";
import { runCli } from "./helpers/cli.ts";

// The verb surface e2e: the spawned binary's capture and serve, against the SDK's own output for
// the same input. The resolution RULES (verb table, escapes, flag scope) are unit-pinned in
// packages/cli/src/cli.unit.test.ts; here the binary must produce the SDK's shape end to end.

jest.setTimeout(60_000);

const FIXTURE = join(import.meta.dir, "fixtures", "sample-file.ts");

describe("cli verbs e2e — capture and serve through the spawned binary", () => {
  test("capture over a fixture with --json: byte shape matches the SDK capture() elements", async () => {
    const r = await runCli(["capture", FIXTURE, "--json"], { timeout: 60_000 });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    // the CLI is a thin print: the document's elements ARE the SDK's CapturedElement array for
    // the same target - same walk, same grammar, same spans
    expect(JSON.parse(r.stdout)).toEqual({ elements: await capture(FIXTURE) });
  });

  test("capture lines: one line per element, pipe-clean (single file: no input column)", async () => {
    const r = await runCli(["capture", FIXTURE], { timeout: 60_000 });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines.length).toBe((await capture(FIXTURE)).length);
    for (const line of lines) {
      // grammar kind L<start>-L<end> name|'-' - the span keeps both lines for a stable column
      expect(line).toMatch(
        /^(typescript|tsx|python|markdown|php|go|cpp|c|css) \S+ L\d+-L\d+ (\S+.*|-)$/,
      );
    }
    expect(lines.some((line) => line.split(" ").length === 4)).toBe(true);
  });

  test("serve with an unknown run id is a loud usage error (exit 2), no UI started", async () => {
    const r = await runCli(["serve", "nosuchrun"], { timeout: 60_000 });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no run 'nosuchrun' in the run store");
    expect(r.stdout).toBe("");
  });
});
