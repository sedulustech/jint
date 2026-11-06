/**
 * The binaries mirror: serves release assets out of an R2 bucket under /dl/. The bucket mirrors
 * GitHub's release layout (`latest/download/<asset>`, `download/<tag>/<asset>`), so install.sh
 * works against `RELEASE_BASE=<site>/dl` unchanged. The beta channel keeps one build at a time at
 * `download/beta-<sha6>/` (immutable, so it caches for a year), and `download/beta/COMMIT` names
 * the current commit. Any other `download/beta/<asset>` redirects to the current build, so a link
 * or a bookmark never mixes files from two builds.
 */

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
const REVALIDATE = "no-cache";
const BETA_POINTER = "download/beta/COMMIT";
const isMoving = (key: string): boolean => key.startsWith("latest/") || key === BETA_POINTER;

/** The slice of Cloudflare's edge cache (the Cache API) this uses. */
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** Keys that never change once written: tagged releases and `download/beta-<sha6>/` builds. */
export const isImmutable = (key: string): boolean =>
  !isMoving(key) && !key.startsWith("download/beta/");

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

/**
 * The key an object is cached under: a path nobody links, on the site's own origin. The cache never
 * holds the public `/dl/` URL, so the edge cannot answer a download itself and every request
 * reaches the function that counts it. A range request keeps its Range header, so a hit can answer
 * a resumed download.
 */
const cacheKeyOf = (request: Request, key: string, ranged: boolean): Request => {
  const range = ranged ? request.headers.get("range") : null;
  return new Request(new URL(`/__dl-cache/${key}`, request.url), {
    headers: range === null ? undefined : { range },
  });
};

/**
 * ServeObject behind the edge cache, for immutable keys only: a full GET that misses is stored
 * after it answers, and a hit never reaches the bucket. Ranges, HEADs, redirects, the pointer,
 * `latest/` and every non-200 answer pass through uncached.
 */
export async function serveCached(
  request: Request,
  bucket: Bucket,
  key: string,
  cache: EdgeCache,
  waitUntil: (work: Promise<unknown>) => void,
): Promise<Response> {
  const cacheable = request.method === "GET" && isImmutable(key);
  if (cacheable) {
    const hit = await cache.match(cacheKeyOf(request, key, true));
    if (hit !== undefined) return hit;
  }
  const response = await serveObject(request, bucket, key);
  if (cacheable && response.status === 200) {
    waitUntil(cache.put(cacheKeyOf(request, key, false), response.clone()));
  }
  return response;
}

async function redirectToBeta(request: Request, bucket: Bucket, key: string): Promise<Response> {
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

/** The bucket read for a GET or HEAD; only a GET that sends a Range header asks for a range. */
function readObject(
  request: Request,
  bucket: Bucket,
  key: string,
  wantsRange: boolean,
): Promise<BucketObject | null> {
  if (request.method === "HEAD") return bucket.head(key);
  return bucket.get(key, {
    range: wantsRange ? request.headers : undefined,
    onlyIf: request.headers,
  });
}

/** The response headers for an object, and for the byte range of it being served, if any. */
function objectHeaders(object: BucketObject, key: string, range: BucketObject["range"]): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("content-type", contentType(key));
  headers.set("cache-control", isMoving(key) ? REVALIDATE : IMMUTABLE);
  headers.set("content-length", String(range?.length ?? object.size));
  if (key.endsWith(".tar.gz")) {
    headers.set("content-disposition", `attachment; filename="${key.split("/").pop()}"`);
  }
  if (range !== undefined) {
    const { offset, length } = range;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
  }
  return headers;
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
    return redirectToBeta(request, bucket, key);
  }
  const wantsRange = request.method === "GET" && request.headers.has("range");
  const object = await readObject(request, bucket, key, wantsRange);
  if (object === null) return new Response("not found", { status: 404 });

  const range = wantsRange ? object.range : undefined;
  const headers = objectHeaders(object, key, range);
  if (request.method === "GET" && object.body === undefined) {
    headers.delete("content-length");
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: range !== undefined ? 206 : 200,
    headers,
  });
}

/** The slice of an Analytics Engine dataset this writes to (`env.DOWNLOADS`). */
export interface Dataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export const clientOf = (userAgent: string | null): string => {
  const agent = (userAgent ?? "").toLowerCase();
  if (agent.startsWith("curl/")) return "curl";
  if (agent.startsWith("wget/")) return "wget";
  return agent.startsWith("mozilla/") ? "browser" : "other";
};

/**
 * What one finished request records, or null when it is not a download: a tarball counts once, on
 * the GET that starts it (a full 200, or the 206 whose range starts at byte 0), so HEADs, resumed
 * ranges, 304s, checksums and the beta pointer add nothing.
 *
 * Schema of the dataset (the order is fixed; add to the end only): index1 version (a tag or the
 * beta sha6) - the sampling key blob1 channel: beta | latest | release blob2 version blob3 asset,
 * such as jint-linux-x64.tar.gz blob4 client: curl | wget | browser | other blob5 country (two
 * letters, empty when unknown) double1 downloads (always 1, so a sampled query sums it) double2
 * bytes
 */
export function downloadPoint(
  request: Request,
  key: string,
  response: Response,
): { blobs: string[]; doubles: number[]; indexes: string[] } | null {
  if (request.method !== "GET" || !key.endsWith(".tar.gz")) return null;
  const startsAtZero = response.headers.get("content-range")?.startsWith("bytes 0-") === true;
  if (!(response.status === 200 || (response.status === 206 && startsAtZero))) return null;
  const parts = key.split("/");
  const asset = parts[parts.length - 1]!;
  const channel = key.startsWith("latest/")
    ? "latest"
    : parts[1]?.startsWith("beta-")
      ? "beta"
      : "release";
  const version = channel === "latest" ? "latest" : (parts[1] ?? "");
  const country = (request as { cf?: { country?: string } }).cf?.country ?? "";
  return {
    blobs: [channel, version, asset, clientOf(request.headers.get("user-agent")), country],
    doubles: [1, Number(response.headers.get("content-length") ?? 0)],
    indexes: [version],
  };
}

/**
 * Records a download. Counting never changes the answer: a missing binding or a failed write is
 * logged with the key, and the download goes on.
 */
export function countDownload(
  dataset: Dataset | undefined,
  request: Request,
  key: string,
  response: Response,
): void {
  try {
    const point = downloadPoint(request, key, response);
    if (point === null) return;
    if (dataset === undefined) {
      // oxlint-disable-next-line no-console
      console.warn("downloads binding missing, download not counted:", key);
      return;
    }
    dataset.writeDataPoint(point);
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error("download count failed:", key, error);
  }
}
