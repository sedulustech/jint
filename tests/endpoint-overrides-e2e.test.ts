import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockDecisionsWire, runCli } from "./helpers/cli.ts";
import { startMockDecisions } from "./helpers/mock-provider.ts";

// The env overrides reach a real run: visible in the report's notes and the manifest (host only),
// and no key value appears in any output or recorded file.

test("a url and key override is noted and recorded without the key", async () => {
  const provider = startMockDecisions();
  const runs = mkdtempSync(join(tmpdir(), "jint-overrides-"));
  const key = "sk-override-secret-0123";
  const proc = await runCli(
    ["run", "packages/cli/src/logger.ts", "--rule", "is_greppable", "--json"],
    {
      env: {
        JINT_API_URL: `http://user:pw@${provider.baseUrl.replace("http://", "")}/x/v1/decisions`,
        JINT_API_KEY: key,
        JINT_RUNS_DIR: runs,
      },
    },
  );
  provider.stop();
  const host = new URL(provider.baseUrl).host;
  const report = JSON.parse(proc.stdout);
  expect(report.notes).toContain(`url overridden, host ${host}`);
  expect(report.notes).toContain("key from JINT_API_KEY");

  const dir = join(runs, readdirSync(runs)[0]!);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  expect(manifest).toMatchObject({ model: "gpt-6-luna", providerHost: host });

  const recorded = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8"));
  const requestFile = JSON.parse(
    recorded[readdirSync(dir).findIndex((f) => f !== "manifest.json" && f !== "report.json")]!,
  );
  expect(requestFile.url).not.toContain("pw");
  for (const text of [proc.stdout, proc.stderr, ...recorded]) {
    expect(text).not.toContain(key);
    expect(text).not.toContain("pw@"); // userinfo never lands in a recorded url
  }
});

test("the run asks POST /v1/decisions; the recording is the real exchange, without the key", async () => {
  const provider = startMockDecisions({ predicate: 0.3 });
  const runs = mkdtempSync(join(tmpdir(), "jint-decisions-"));
  const key = "sk-decisions-secret-0123";
  const proc = await runCli(
    ["run", "packages/cli/src/logger.ts", "--rule", "is_greppable", "--json"],
    {
      env: {
        ...mockDecisionsWire(provider.baseUrl),
        JINT_API_KEY: key,
        JINT_RUNS_DIR: runs,
      },
    },
  );
  provider.stop();
  const host = new URL(provider.baseUrl).host;
  const report = JSON.parse(proc.stdout);
  expect(report.notes).toContain(`url overridden, host ${host}`);
  expect(provider.requests.length).toBeGreaterThan(0);

  const dir = join(runs, readdirSync(runs)[0]!);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  expect(manifest).toMatchObject({ model: "gpt-6-luna", providerHost: host });
  const names = readdirSync(dir).filter((f) => f !== "manifest.json" && f !== "report.json");
  expect(names).toHaveLength(provider.requests.length);
  const files = names.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  const sent = provider.requests.map((r) => JSON.stringify(r.body)).sort();
  expect(files.map((f) => JSON.stringify(f.request)).sort()).toEqual(sent);
  for (const file of files) {
    expect(file.wire).toBeUndefined();
    expect(file.response.answers[0]).toMatchObject({ type: "predicate", name: "q0" });
    expect(sent.join()).not.toContain(file.id);
  }
  for (const f of readdirSync(dir)) {
    expect(readFileSync(join(dir, f), "utf8")).not.toContain(key);
  }
  expect(proc.stdout + proc.stderr).not.toContain(key);
});
