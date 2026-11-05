/**
 * The binaries mirror: serves release assets out of an R2 bucket under /dl/. The bucket mirrors
 * GitHub's release layout (`latest/download/<asset>`, `download/<tag>/<asset>`), so install.sh
 * works against `RELEASE_BASE=<site>/dl` unchanged. The beta channel keeps one build at a time at
 * `download/beta-<sha6>/` (immutable, so it caches for a year), and `download/beta/COMMIT` names
 * the current commit. Any other `download/beta/<asset>` redirects to the current build, so a link
 * or a bookmark never mixes files from two builds.
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
// these keys are overwritten in place (the newest release, the beta pointer): a cache keeps its copy
// but asks the ETag on every use, so a new publish shows at once and an unchanged file is a 304
const REVALIDATE = "no-cache";
const BETA_POINTER = "download/beta/COMMIT";
const isMoving = (key: string): boolean => key.startsWith("latest/") || key === BETA_POINTER;

/** The directory a beta build lives in: the first 6 characters of its commit. */
export const betaDir = (commit: string): string => `download/beta-${commit.trim().slice(0, 6)}`;

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
  if (key.startsWith("download/beta/") && key !== BETA_POINTER) {
    const pointer = await bucket.get(BETA_POINTER);
    if (pointer?.body === undefined) return new Response("not found", { status: 404 });
    const commit = (await new Response(pointer.body).text()).trim();
    if (commit.length < 6) return new Response("not found", { status: 404 });
    const mount = new URL(request.url).pathname.slice(0, -key.length);
    const rest = key.slice("download/beta/".length);
    return new Response(null, {
      status: 302,
      headers: { location: `${mount}${betaDir(commit)}/${rest}`, "cache-control": REVALIDATE },
    });
  }
  // Only a GET that sends a Range header is a range request. R2 reports a range on any read it was
  // handed the request headers for, so a plain GET, and every HEAD, would otherwise answer 206.
  const wantsRange = request.method === "GET" && request.headers.has("range");
  const object =
    request.method === "HEAD"
      ? await bucket.head(key)
      : await bucket.get(key, {
          range: wantsRange ? request.headers : undefined,
          onlyIf: request.headers,
        });
  if (object === null) return new Response("not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("content-type", contentType(key));
  headers.set("cache-control", isMoving(key) ? REVALIDATE : IMMUTABLE);
  const range = wantsRange ? object.range : undefined;
  headers.set("content-length", String(range?.length ?? object.size));
  if (key.endsWith(".tar.gz")) {
    headers.set("content-disposition", `attachment; filename="${key.split("/").pop()}"`);
  }
  if (range !== undefined) {
    const { offset, length } = range;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
  }
  // an unmet precondition returns the object without a body: the client's copy is current
  if (request.method === "GET" && object.body === undefined) {
    headers.delete("content-length");
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: range !== undefined ? 206 : 200,
    headers,
  });
}
