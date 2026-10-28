import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// jint talks to the Decisions API only, and the url is the selector: no provider table, no
// provider or model switch, no per-provider key variable, no gateway adapter. This guard fails the
// suite when a removed name comes back in any tracked file - code, config, lockfile, generated docs
// or skills. JINT_PROVIDER_URL and JINT_PROVIDER_KEY stay; the bare JINT_PROVIDER does not. The
// allowlist is where the past is the point: calibration records, the reader of recorded
// gateway-shaped files (and its tests, and the recordings), and this file.

const ROOT = join(import.meta.dir, "../../../../..");

const REMOVED =
  /JINT_PROVIDER(?![A-Za-z_])|JINT_MODEL|JINT_OPENAI_API_KEY|JINT_AI_GATEWAY_API_KEY|decision-model|decisionModelAdapter|resolveProvider|assertProviderKey|ai-gateway\.vercel|startMockGateway/;

const ALLOWED: string[] = [
  "docs/calibration/", // historical calibration records
  "packages/sdk/src/ui/request-file.ts", // the legacy/gateway-shape reader
  "packages/sdk/src/ui/request-file.test.ts", // its tests
  "packages/app/tests/fixtures/", // recorded runs, legacy shape included
  "packages/sdk/src/core/provider/endpoint.test.ts", // proves the removed variables are ignored
  "packages/sdk/src/core/provider/removed-names.guard.test.ts", // this guard
];

const allowed = (path: string): boolean => ALLOWED.some((a) => path === a || path.startsWith(a));

describe("removed-names guard", () => {
  test("no tracked file outside the allowlist names a removed provider-selection piece", () => {
    const listed = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: ROOT });
    expect(listed.exitCode).toBe(0);
    const files = new TextDecoder().decode(listed.stdout).split("\0").filter(Boolean);
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const file of files) {
      if (allowed(file)) continue;
      let text: string;
      try {
        text = readFileSync(join(ROOT, file), "utf8");
      } catch {
        continue; // deleted in the working tree, or a directory entry (submodule)
      }
      if (REMOVED.test(text) || REMOVED.test(file)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("the removed variables are not read by the endpoint resolver", async () => {
    const { resolveEndpoint } = await import("./endpoint.ts");
    const r = resolveEndpoint(
      {},
      {
        JINT_PROVIDER: "x",
        JINT_MODEL: "x",
        JINT_OPENAI_API_KEY: "x",
        JINT_AI_GATEWAY_API_KEY: "x",
      },
    );
    expect(r.apiKey).toBeUndefined();
    expect(r.url).toBe("https://api.openai.com/v1/decisions");
  });

  test("the allowlist names only paths that exist", () => {
    for (const path of ALLOWED) expect(existsSync(join(ROOT, path)), path).toBe(true);
  });
});
