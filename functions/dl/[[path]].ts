import { keyOf, serveObject, type Bucket } from "../../web/src/lib/dl.ts";

interface Env {
  /** The R2 bucket holding the release mirror (wrangler.toml binds it). */
  BINARIES: Bucket;
}

export const onRequest = async (context: {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
}): Promise<Response> => {
  const key = keyOf(context.params.path);
  if (key === null) return new Response("not found", { status: 404 });
  return serveObject(context.request, context.env.BINARIES, key);
};
