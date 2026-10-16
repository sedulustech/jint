import { serveApiRequest } from "@jint/sdk/ui/api";
import type { Plugin } from "vite";

/**
 * Dev-server mount of the shared run-store API route module (it lives in @jint/sdk; the run store
 * is SDK-owned). Default root: the SDK's runsBase resolution (JINT_RUNS_DIR / the homedir store)
 * homedir store) — opts.root names the store explicitly for embedded servers.
 */
export function apiPlugin(opts: { root?: string } = {}): Plugin {
  return {
    name: "jint-measurement-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        const origin = `http://${req.headers.host ?? "localhost"}`;
        serveApiRequest(
          new Request(origin + req.url, {
            method: req.method,
            headers: new Headers(req.headers as Record<string, string>),
          }),
          { root: opts.root },
        )
          .then(async (r) => {
            if (r === null) return next();
            res.statusCode = r.status;
            res.setHeader("content-type", r.headers.get("content-type") ?? "application/json");
            res.end(await r.text());
          })
          .catch((err) => {
            res.statusCode = 500;
            res.end(String(err));
          });
      });
    },
  };
}
