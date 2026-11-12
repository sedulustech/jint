import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveApiRequest } from "./api.ts";

const noul = {
  name: "has_x",
  instructions: "Is x here?",
  criteria: { true: "x is here", false: "x is absent" },
  handle: { warn: { greater_than: 0.5 } },
};
const score = {
  name: "is_hard",
  criteria: ["easy", "hard"],
  handle: { map: ["pass", "error"] },
};

function writeRun(
  root: string,
  id: string,
  report: { rules: unknown[]; classifications: object[]; findings: object[] },
): void {
  mkdirSync(join(root, id));
  writeFileSync(join(root, id, "1700000000000-a.json"), "{}");
  writeFileSync(join(root, id, "manifest.json"), JSON.stringify({ configPath: null }));
  writeFileSync(join(root, id, "report.json"), JSON.stringify(report));
}

describe("GET /api/rules", () => {
  test("lists each rule once with its kind, instructions and per-run history, oldest first", async () => {
    const root = mkdtempSync(join(tmpdir(), "jint-ui-rules-"));
    try {
      writeRun(root, "100", {
        rules: [noul, score],
        classifications: [
          { rule: "has_x", input: "a", value: 0.9 },
          { rule: "has_x", input: "b", value: 0.1, cached: true },
          { rule: "is_hard", input: "a", value: 1 },
        ],
        findings: [{ rule: "has_x", input: "a", severity: "warn" }],
      });
      writeRun(root, "200", {
        rules: [noul],
        classifications: [{ rule: "has_x", input: "a", value: 0.2 }],
        findings: [],
      });
      const res = (await serveApiRequest(new Request("http://x/api/rules"), { root })) as Response;
      const body = (await res.json()) as {
        rules: {
          name: string;
          kind: string;
          instructions?: string;
          runs: { id: string; n: number; fired: number; cached: number }[];
        }[];
      };
      const byName = Object.fromEntries(body.rules.map((r) => [r.name, r]));
      expect(body.rules).toHaveLength(2);
      expect(byName.has_x?.kind).toBe("noul");
      expect(byName.has_x?.instructions).toBe("Is x here?");
      expect(byName.has_x?.runs).toEqual([
        { id: "100", n: 2, fired: 1, cached: 1 },
        { id: "200", n: 1, fired: 0, cached: 0 },
      ]);
      expect(byName.is_hard?.kind).toBe("score");
      expect(byName.is_hard?.instructions).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an empty store answers an empty list", async () => {
    const res = (await serveApiRequest(new Request("http://x/api/rules"), {
      root: join(tmpdir(), "no-such-rules-root-98765"),
    })) as Response;
    const body = (await res.json()) as { rules: unknown[] };
    expect(body.rules).toEqual([]);
  });
});
