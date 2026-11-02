/**
 * The binaries mirror: serves release assets out of an R2 bucket under /dl/. The bucket mirrors
 * GitHub's release layout (`latest/download/<asset>`, `download/<tag>/<asset>`), so install.sh
 * works against `RELEASE_BASE=<site>/dl` unchanged. `download/beta/` is the unversioned beta
 * channel: overwritten on every push, so it never gets the immutable cache a tagged release does.
 */

/** The slice of an R2 bucket this serves from (Cloudflare's own types are not a dependency). */
export interface Bucket {
  get(key: string, options?: { range?: Headers; onlyIf?: Headers }): Promise<BucketObject | null>;
  head(key: string): Promise<BucketObject | null>;
}

export interface BucketObject {
  key: string;
  size: number;
  httpEtag: string;
  body?: ReadableStream;
  range?: { offset: number; length: number };
  writeHttpMetadata(headers: Headers): void;
}

const IMMUTABLE = "public, max-age=31536000, immutable";
// these keys are overwritten in place (the newest release, the beta channel): short, so a new
// build shows up within a minute
const LATEST = "public, max-age=60";
const isMoving = (key: string): boolean =>
  key.startsWith("latest/") || key.startsWith("download/beta/");

const contentType = (key: string): string =>
  key.endsWith(".tar.gz") ? "application/gzip" : "text/plain; charset=utf-8";

/** A key inside the bucket from the URL's path segments, or null for anything traversal-shaped. */
export function keyOf(segments: readonly string[] | string | undefined): string | null {
  const parts = typeof segments === "string" ? segments.split("/") : [...(segments ?? [])];
  if (parts.length === 0 || parts.some((p) => p === "" || p === "." || p === "..")) return null;
  if (parts.some((p) => p.includes("\\") || p.includes("\0"))) return null;
  return parts.join("/");
}

export async function serveObject(
  request: Request,
  bucket: Bucket,
  key: string,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const object =
    request.method === "HEAD"
      ? await bucket.head(key)
      : await bucket.get(key, { range: request.headers, onlyIf: request.headers });
  if (object === null) return new Response("not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("content-type", contentType(key));
  headers.set("cache-control", isMoving(key) ? LATEST : IMMUTABLE);
  headers.set("content-length", String(object.range?.length ?? object.size));
  if (key.endsWith(".tar.gz")) {
    headers.set("content-disposition", `attachment; filename="${key.split("/").pop()}"`);
  }
  if (object.range !== undefined) {
    const { offset, length } = object.range;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
  }
  // an unmet precondition returns the object without a body: the client's copy is current
  if (request.method === "GET" && object.body === undefined) {
    headers.delete("content-length");
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: object.range !== undefined ? 206 : 200,
    headers,
  });
}
