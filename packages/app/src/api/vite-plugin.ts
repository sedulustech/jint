import { serveApiRequest } from "@jint/sdk/ui/api";
import type { Plugin } from "vite";

/**
 * Dev-server mount of the shared run-store API route module (it lives in @jint/sdk; the run store
 * is SDK-owned). Default root: the SDK's runsBase resolution (JINT_RUNS_DIR / the homedir store)
 * homedir store) — opts.root names the store explicitly for embedded servers.
 */
export function apiPlugin(opts: { root?: string } = {}): Plugin {
  return {
    name: "jint-classification-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        const origin = `http://${req.headers.host ?? "localhost"}`;
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          serveApiRequest(
            new Request(origin + req.url, {
              method: req.method,
              headers: new Headers(req.headers as Record<string, string>),
              body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
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
      });
    },
  };
}
