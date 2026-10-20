import { join } from "node:path";
/**
 * Prod server: serves the built static dir (dist/) plus the SAME shared API route module the vite
 * dev plugin mounts (the handler lives in @jint/sdk — the run store is SDK-owned). Run: bun run
 * build && bun run serve. The API serves the runs store (default ~/.jint/runs); the runs root is
 * overridable via server opts.
 */
import { serveApiRequest } from "@jint/sdk/ui/api";
import { compress, hostAllowed, hostForbidden, normalizeUiHost } from "@jint/sdk/ui/serve";

const dist = join(import.meta.dir, "dist");
// loopback-only by default; JINT_UI_HOST opts out — a non-loopback bind is the user's trust decision
const hostname = normalizeUiHost(process.env.JINT_UI_HOST ?? "127.0.0.1");

Bun.serve({
  port: Number(process.env.JINT_UI_PORT ?? 5178),
  hostname,
  async fetch(req) {
    if (!hostAllowed(req.headers.get("host"), hostname)) return hostForbidden();
    const api = await serveApiRequest(req);
    if (api !== null) return compress(api, req);
    const url = new URL(req.url);
    const candidates = [
      url.pathname,
      url.pathname === "/" ? "index.html" : url.pathname + "/index.html",
      "index.html",
    ];
    for (const rel of candidates) {
      const file = Bun.file(join(dist, rel.replace(/^\//, "")));
      if (await file.exists()) return compress(new Response(file), req);
    }
    return new Response("not found", { status: 404 });
  },
});
process.stdout.write(
  `jint ui on http://${hostname}:${process.env.JINT_UI_PORT ?? 5178} (dist: ${dist})` + "\n",
);
