import { handleApi } from "./handler.ts";
import type { Plugin } from "vite";

/**
 * Dev-server mount of the shared API route module. The root is explicit: there is no env fallback
 * in requestsRoot anymore, so embedded servers must say what they serve.
 */
export function apiPlugin(opts: { root?: string } = {}): Plugin {
  return {
    name: "jint-measurement-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        const origin = `http://${req.headers.host ?? "localhost"}`;
        handleApi(
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
