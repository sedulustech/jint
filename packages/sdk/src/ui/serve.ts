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
    // the binary's embedded UI assets (readable under $bunfs root)
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

/**
 * Host-header allowlist, the shared defense-in-depth check every server surface applies before
 * serveApiRequest dispatch: the API serves full judged source text, so a spoofed Host (DNS
 * rebinding, LAN peer) must not reach it. Allowed: localhost / 127.0.0.1 / [::1] (port suffix
 * optional) plus the actually bound host when a custom JINT_UI_HOST opted out of loopback — that
 * override is the user's trust decision.
 */
export function hostAllowed(hostHeader: string | null, boundHost: string): boolean {
  if (hostHeader === null) return false;
  let host = hostHeader.trim().toLowerCase();
  // [::1]:5178 -> [::1]
  const bracket = host.indexOf("]");
  if (bracket !== -1) {
    host = host.slice(0, bracket + 1);
  } else {
    // 127.0.0.1:5178 -> 127.0.0.1
    const colon = host.indexOf(":");
    if (colon !== -1) host = host.slice(0, colon);
  }
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === headerForm(boundHost)
  );
}

/**
 * The bound host as a Host header spells it: lowercase (DNS names are case-insensitive), and an
 * IPv6 literal bracketed (a bare ::1 bind arrives as [::1]:port).
 */
function headerForm(boundHost: string): string {
  const host = boundHost.toLowerCase();
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/**
 * JINT_UI_HOST (and the host option) names a HOST, never host:port — the port is JINT_UI_PORT's
 * job. A :port suffix is rejected with an error naming the right var, not silently stripped: a
 * silent strip would let the configured value disagree with the bound host. Bracketed IPv6 ([::1])
 * is a host, not host:port, and passes through untouched.
 */
export function normalizeUiHost(raw: string): string {
  if (!/:\d+$/.test(raw) || ((raw.match(/:/g) ?? []).length !== 1 && !raw.includes("]")))
    return raw;
  throw new Error(`jint ui: '${raw}' names a host, not host:port — put the port in JINT_UI_PORT`);
}

/** The 403 for a rejected Host, shared so both surfaces answer identically. */
export function hostForbidden(): Response {
  return new Response("forbidden host", { status: 403 });
}

/** StartUi's handle: where the UI lives and how to stop it. */
export interface UiServer {
  url: string;
  port: number;
  close: () => void;
}

export interface StartUiOptions {
  /** TCP port; default JINT_UI_PORT, else an ephemeral one. */
  port?: number;
  /** Built static dir to serve; default JINT_UI_DIST, else the dev checkout's app dist. */
  distDir?: string;
  /** Absolute runs root to serve; default the runs store's resolution (JINT_RUNS_DIR / homedir). */
  root?: string;
  /**
   * Bind host; default JINT_UI_HOST, else loopback (127.0.0.1). A non-loopback host is the user's
   * trust decision.
   */
  host?: string;
}

/**
 * Serve the run UI in-process: /api/* answers from the shared run-store handler, everything else
 * from the built static dir (SPA fallback to index.html), both under the same compression
 * treatment. The port precedence is JINT_UI_PORT, then an ephemeral fallback; bare PORT (the former
 * portless integration) is no longer read.
 */
export async function startUi(options: StartUiOptions = {}): Promise<UiServer> {
  const distDir = resolveDistDir(options.distDir);
  // precedence: explicit option > env > default (host: JINT_UI_HOST, else loopback-only)
  const envPort = process.env.JINT_UI_PORT;
  const envHost = process.env.JINT_UI_HOST;
  const hostname = normalizeUiHost(options.host ?? (envHost !== undefined ? envHost : "127.0.0.1"));
  const server = Bun.serve({
    port: options.port ?? (envPort !== undefined ? Number(envPort) : 0),
    hostname,
    async fetch(req) {
      if (!hostAllowed(req.headers.get("host"), hostname)) return hostForbidden();
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
