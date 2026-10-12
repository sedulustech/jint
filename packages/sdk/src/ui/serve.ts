import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
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
    // zlib's default quality is 11: ~7.5s of CPU on a big run payload. q5 is ~190x faster
    // at +22% size (and still smaller than gzip) - localhost UI latency is all that matters here.
    return new Response(
      brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
      {
        status: res.status,
        headers: { "content-type": type, "content-encoding": "br", vary: "Accept-Encoding" },
      },
    );
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
 * The built UI's static dir, in precedence order: an explicit option, the JINT_UI_DIST env (the
 * documented remedy must beat a possibly stale embed), the binary's embedded assets, then the dev
 * checkout's packages/app/dist when it exists. Absent everything, the error names the remedy.
 */
export function resolveDistDir(distDir?: string): string {
  const candidates = [
    distDir,
    process.env.JINT_UI_DIST,
    // the binary's embedded UI (scripts/build.ts compile assets; readable under $bunfs root)
    (Bun.embeddedFiles ?? []).some(
      (file) => (file as Blob & { name: string }).name === "dist/index.html",
    )
      ? join(import.meta.dir, "dist")
      : undefined,
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
  /** TCP port; default JINT_UI_PORT, else PORT (portless), else an ephemeral one. */
  port?: number;
  /** Built static dir to serve; default JINT_UI_DIST, else the dev checkout's app dist. */
  distDir?: string;
  /** Absolute runs root to serve; default the SDK's runsDir resolution (runsBase). */
  root?: string;
}

/**
 * Serve the run UI in-process: /api/* answers from the shared run-store handler, everything else
 * from the built static dir (SPA fallback to index.html), both under the same compression
 * treatment. The port precedence is JINT_UI_PORT over PORT (portless injects PORT; that is the
 * zero-code integration and keeps working), else an ephemeral port.
 */
export async function startUi(options: StartUiOptions = {}): Promise<UiServer> {
  const distDir = resolveDistDir(options.distDir);
  // precedence: explicit option > JINT_UI_PORT > PORT (portless injects PORT) > ephemeral
  const envPort = process.env.JINT_UI_PORT ?? process.env.PORT;
  const server = Bun.serve({
    port: options.port ?? (envPort !== undefined ? Number(envPort) : 0),
    async fetch(req) {
      const api = await serveApiRequest(req, { root: options.root });
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
