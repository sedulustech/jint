import { join } from "node:path";
import { gzipSync, brotliCompressSync } from "node:zlib";
/**
 * Prod server: serves the built static dir (dist/) plus the SAME shared API route module the vite
 * dev plugin mounts. Run: bun run build && bun run serve. The API serves the runs store (default
 * ~/.jint/runs); the runs root is overridable via server opts.
 */
import { serveApiRequest } from "./src/api/handler.ts";

/**
 * Response compression, standard Accept-Encoding negotiation: br preferred, then gzip, else
 * identity. Applies to compressible types (JSON API responses and text assets); the run-summary
 * fetch is ~0.9 MB raw and drops ~10x on the wire.
 */
async function compress(res: Response, req: Request): Promise<Response> {
  const type = res.headers.get("content-type") ?? "";
  if (!/json|text|javascript/.test(type)) return res;
  const accept = req.headers.get("accept-encoding") ?? "";
  const buf = new Uint8Array(await res.arrayBuffer());
  if (accept.includes("br")) {
    return new Response(brotliCompressSync(buf), {
      status: res.status,
      headers: { "content-type": type, "content-encoding": "br", vary: "Accept-Encoding" },
    });
  }
  if (accept.includes("gzip")) {
    return new Response(gzipSync(buf), {
      status: res.status,
      headers: { "content-type": type, "content-encoding": "gzip", vary: "Accept-Encoding" },
    });
  }
  return new Response(buf, {
    status: res.status,
    headers: { "content-type": type, vary: "Accept-Encoding" },
  });
}

const dist = join(import.meta.dir, "dist");

Bun.serve({
  port: Number(process.env.PORT ?? 5178),
  async fetch(req) {
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
  `jint ui on http://localhost:${process.env.PORT ?? 5178} (dist: ${dist})` + "\n",
);
