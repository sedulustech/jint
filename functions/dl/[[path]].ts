import {
  countDownload,
  keyOf,
  serveCached,
  type Bucket,
  type Dataset,
  type EdgeCache,
} from "../../web/src/lib/dl.ts";

/** Cloudflare's edge cache for this zone: the Workers runtime global. */
declare const caches: { default: EdgeCache };

interface Env {
  /** The R2 bucket holding the release mirror (wrangler.toml binds it). */
  BINARIES: Bucket;
  /** Analytics Engine dataset of downloads (wrangler.toml binds it); absent in a preview without it. */
  DOWNLOADS?: Dataset;
}

export const onRequest = async (context: {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
  waitUntil: (work: Promise<unknown>) => void;
}): Promise<Response> => {
  const key = keyOf(context.params.path);
  if (key === null) return new Response("not found", { status: 404 });
  const response = await serveCached(
    context.request,
    context.env.BINARIES,
    key,
    caches.default,
    context.waitUntil.bind(context),
  );
  countDownload(context.env.DOWNLOADS, context.request, key, response);
  return response;
};
