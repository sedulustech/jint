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

const HOSTILE: Record<string, string> = {
  OPENAI_API_KEY: "sk-hostile-key",
  OPENAI_ADMIN_KEY: "sk-hostile-admin",
  OPENAI_BASE_URL: "http://127.0.0.1:1/hostile",
  OPENAI_ORG_ID: "org-hostile",
  OPENAI_PROJECT_ID: "proj-hostile",
  OPENAI_WEBHOOK_SECRET: "whsec-hostile",
  OPENAI_LOG: "debug",
  OPENAI_CUSTOM_HEADERS: "X-Hostile: leaked",
};

test("hostile OPENAI_* variables change neither the host, the key nor the headers", async () => {
  const provider = startMockDecisions({ predicate: 0.4 });
  const runs = mkdtempSync(join(tmpdir(), "jint-foreign-env-"));
  await runCli(["run", "packages/cli/src/logger.ts", "--rule", "is_greppable", "--json"], {
    env: {
      ...HOSTILE,
      JINT_API_URL: `${provider.baseUrl}/v1/decisions`,
      JINT_API_KEY: "configured-key",
      JINT_RUNS_DIR: runs,
    },
  });
  provider.stop();
  expect(provider.requests.length).toBeGreaterThan(0);
  for (const request of provider.requests) {
    expect(request.headers.authorization).toBe("Bearer configured-key");
    expect(JSON.stringify(request.headers)).not.toMatch(/hostile|leaked|org-|proj-/i);
    expect(Object.keys(request.headers).filter((h) => /openai|hostile/i.test(h))).toEqual([]);
  }
  // no recorded file holds a key, an Authorization header or a hostile value
  const dir = join(runs, readdirSync(runs)[0]!);
  for (const name of readdirSync(dir)) {
    expect(readFileSync(join(dir, name), "utf8")).not.toMatch(
      /configured-key|Authorization|Bearer|hostile|leaked/i,
    );
  }
});

test("with no JINT_RUNS_DIR the run is recorded under the home directory's store", async () => {
  const provider = startMockDecisions();
  const home = mkdtempSync(join(tmpdir(), "jint-home-"));
  const proc = await runCli(
    ["run", "packages/cli/src/logger.ts", "--rule", "is_greppable", "--json"],
    {
      env: { ...mockDecisionsWire(provider.baseUrl), JINT_RUNS_DIR: undefined, HOME: home },
    },
  );
  provider.stop();
  expect(proc.code).toBe(0);
  const store = join(home, ".jint", "runs");
  const [run] = readdirSync(store);
  expect(run).toMatch(/^\d+$/);
  expect(readdirSync(join(store, run!)).length).toBeGreaterThan(0);
});
