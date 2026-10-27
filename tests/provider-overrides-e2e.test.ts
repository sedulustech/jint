import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/cli.ts";
import { startMockProvider } from "./helpers/mock-provider.ts";

// The env overrides reach a real run: visible in the report's notes and the manifest (provider and
// host only), and no key value appears in any output or recorded file.

test("a url and key override is noted and recorded without the key", async () => {
  const provider = startMockProvider();
  const runs = mkdtempSync(join(tmpdir(), "jint-overrides-"));
  const key = "sk-override-secret-0123";
  const proc = await runCli(
    ["run", "packages/cli/src/logger.ts", "--rule", "is_greppable", "--json"],
    {
      env: {
        JINT_PROVIDER: "systemone",
        JINT_PROVIDER_URL: `http://user:pw@${provider.baseUrl.replace("http://", "")}/x`,
        JINT_PROVIDER_KEY: key,
        JINT_RUNS_DIR: runs,
      },
    },
  );
  provider.stop();
  const host = new URL(provider.baseUrl).host;
  const report = JSON.parse(proc.stdout);
  expect(report.notes).toContain(`provider systemone: url overridden, host ${host}`);
  expect(report.notes).toContain("provider systemone: key from JINT_PROVIDER_KEY");

  const dir = join(runs, readdirSync(runs)[0]!);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  expect(manifest).toMatchObject({ provider: "systemone", providerHost: host });

  const recorded = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8"));
  // No translation for systemone: the wire is the same call, redacted like the url.
  const requestFile = JSON.parse(
    recorded[readdirSync(dir).findIndex((f) => f !== "manifest.json" && f !== "report.json")]!,
  );
  expect(requestFile.wire.body).toEqual(requestFile.request);
  expect(requestFile.wire.url).not.toContain("pw");
  for (const text of [proc.stdout, proc.stderr, ...recorded]) {
    expect(text).not.toContain(key);
    expect(text).not.toContain("pw@"); // userinfo never lands in a recorded url
  }
});
