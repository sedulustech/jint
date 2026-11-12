import { afterAll, expect, test } from "bun:test";
import { rmScratchTree } from "./helpers/dir.ts";
import { seedStore, startServe, type Served } from "./helpers/ui-serve.ts";

// The real `jint ui serve` process, over a seeded store, asked through HTTP: its port, its bind and
// its host guard are what a user meets.

const scratch: string[] = [];
afterAll(() => scratch.forEach(rmScratchTree));

async function serve(env: Record<string, string | undefined> = {}): Promise<Served> {
  const { seed, dir } = seedStore();
  scratch.push(dir);
  return startServe(seed, env);
}

test("with no port set it takes an ephemeral port, and binds loopback", async () => {
  const server = await serve({ JINT_UI_PORT: undefined, JINT_UI_HOST: undefined });
  try {
    const url = new URL(server.url);
    expect(Number(url.port)).toBeGreaterThan(0);
    expect(url.hostname).toBe("127.0.0.1");
  } finally {
    server.stop();
  }
});

test("JINT_UI_PORT sets the port, and a bare PORT is not read", async () => {
  const taken = await serve({ JINT_UI_PORT: undefined });
  const port = String(Number(new URL(taken.url).port) + 1000);
  taken.stop();
  const server = await serve({ JINT_UI_PORT: port, PORT: "4111" });
  try {
    expect(new URL(server.url).port).toBe(port);
  } finally {
    server.stop();
  }
  const ignored = await serve({ JINT_UI_PORT: undefined, PORT: "4111" });
  try {
    expect(new URL(ignored.url).port).not.toBe("4111");
  } finally {
    ignored.stop();
  }
});

test("JINT_UI_HOST sets the bind, answers its own Host and refuses a foreign one", async () => {
  const server = await serve({ JINT_UI_HOST: "127.0.0.2" });
  try {
    expect(new URL(server.url).hostname).toBe("127.0.0.2");
    expect((await fetch(new URL("/", server.url))).status).toBe(200);
    const foreign = await fetch(new URL("/", server.url), { headers: { host: "evil.example" } });
    expect(foreign.status).toBe(403);
  } finally {
    server.stop();
  }
});

test("a spoofed Host is refused before any route answers, and the real host is served", async () => {
  const server = await serve();
  try {
    const spoofed = await fetch(new URL("/api/runs", server.url), {
      headers: { host: "evil.example" },
    });
    expect(spoofed.status).toBe(403);
    expect((await fetch(new URL("/api/runs", server.url))).status).toBe(200);
  } finally {
    server.stop();
  }
});

test("it serves the store's runs and the dist index.html as the page fallback", async () => {
  const server = await serve();
  try {
    const runs = (await (await fetch(new URL("/api/runs", server.url))).json()) as {
      runs: { id: string }[];
    };
    expect(runs.runs.map((run) => run.id)).toEqual(["100"]);
    const page = await fetch(new URL("/some/page", server.url));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("jint ui");
  } finally {
    server.stop();
  }
});

test("stopping the process closes the port", async () => {
  const server = await serve();
  server.stop();
  await Bun.sleep(500);
  const res = await fetch(new URL("/", server.url)).catch((err: unknown) => err);
  expect(res).toBeInstanceOf(Error);
});
