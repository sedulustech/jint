import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { serveApiRequest } from "./api.ts";

/**
 * Response compression, standard Accept-Encoding negotiation: br preferred, then gzip, else
 * identity. Applies to compressible types (JSON API responses and text assets); the run-summary
 * fetch is ~0.9 MB raw and drops ~10x on the wire. Shared by every server surface (the app's prod
 * server, the SDK's startUi) — one compression treatment, no drift.
 */
export async function compress(res: Response, req: Request): Promise<Response> {
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

/**
 * The built UI's static dir: JINT_UI_DIST names it explicitly, else the dev checkout's
 * packages/app/dist when it exists, else the error names the remedy (build the app or point
 * JINT_UI_DIST at a dist dir).
 */
export function resolveDistDir(distDir?: string): string {
  const candidates = [
    distDir,
    process.env.JINT_UI_DIST,
    join(import.meta.dir, "../../../app/dist"),
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const dir = resolve(candidate);
    if (existsSync(dir)) return dir;
  }
  throw new Error(
    "jint ui: no UI dist found — build it (bun run --cwd packages/app build) or set JINT_UI_DIST to a built dist dir",
  );
}

/** StartUi's handle: where the UI lives and how to stop it. */
export interface UiServer {
  url: string;
  port: number;
  close: () => void;
}

export interface StartUiOptions {
  /** TCP port; default PORT env, else an ephemeral one (portless-friendly). */
  port?: number;
  /** Built static dir to serve; default JINT_UI_DIST, else the dev checkout's app dist. */
  distDir?: string;
}

/**
 * Serve the run UI in-process: /api/* answers from the shared run-store handler, everything else
 * from the built static dir (SPA fallback to index.html), both under the same compression
 * treatment. PORT is honored so portless wraps it with zero portless-specific code.
 */
export async function startUi(options: StartUiOptions = {}): Promise<UiServer> {
  const distDir = resolveDistDir(options.distDir);
  const server = Bun.serve({
    port: options.port ?? (process.env.PORT !== undefined ? Number(process.env.PORT) : 0),
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
        const file = Bun.file(join(distDir, rel.replace(/^\//, "")));
        if (await file.exists()) return compress(new Response(file), req);
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    url: server.url.toString(),
    port: server.port ?? 0,
    close: () => server.stop(true),
  };
}
