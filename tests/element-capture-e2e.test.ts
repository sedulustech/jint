import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mockDecisionsEnv, runCli } from "./helpers/cli.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";
import { startMockDecisions } from "./helpers/mock-provider.ts";
import { startServe } from "./helpers/ui-serve.ts";

// A real run over functions, served by the real `jint ui serve`: each element cell names the
// request file the engine recorded for that element, joined by the element's uuid. This proves
// the engine's writers and the UI's reader agree on the run format.

const scratch: string[] = [];
afterAll(() => scratch.forEach(rmScratchTree));

test("an element cell resolves to the request recorded for that element", async () => {
  const dir = scratchDir("element-capture");
  scratch.push(dir);
  const store = join(dir, "runs");
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "index.html"), "<html></html>");
  const source = join(dir, "pair.ts");
  writeFileSync(
    source,
    "export function first(): number {\n  return 1;\n}\n\nexport function second(): number {\n  return 2;\n}\n",
  );
  const config = join(dir, "jint.config.json");
  writeFileSync(
    config,
    JSON.stringify({
      input: source,
      rules: {
        use: [
          {
            name: "is_probe",
            instructions: "Is it short?",
            criteria: { true: "it holds", false: "it does not hold" },
            target: "functions",
            handle: { warn: { greater_than: 0.5 } },
          },
        ],
      },
    }),
  );
  const provider = startMockDecisions({ predicate: 0.8 });
  try {
    const run = await runCli(["run", "--config", config, "--json"], {
      env: {
        ...mockDecisionsEnv(provider.baseUrl),
        JINT_CACHE_DIR: join(dir, "cache"),
        JINT_RUNS_DIR: store,
      },
    });
    const runId = JSON.parse(run.stdout).run.id as string;
    const server = await startServe({ store, dist });
    try {
      const body = (await (await fetch(new URL(`/api/runs/${runId}`, server.url))).json()) as {
        cells: { input: string; element?: { kind: string }; requestFile?: string }[];
      };
      const elementCells = body.cells.filter((cell) => cell.element?.kind !== "file");
      expect(elementCells).toHaveLength(2);
      for (const cell of elementCells) {
        const elementId = cell.input.split("#")[1];
        const recorded = JSON.parse(readFileSync(join(store, runId, cell.requestFile!), "utf8"));
        expect(recorded.id).toBe(elementId);
      }
    } finally {
      server.stop();
    }
  } finally {
    provider.stop();
  }
});
