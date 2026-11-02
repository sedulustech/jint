import { describe, expect, test } from "bun:test";
import { keyOf, serveObject, type Bucket, type BucketObject } from "./dl.ts";

const bytes = new TextEncoder().encode("0123456789");

function object(key: string, extra: Partial<BucketObject> = {}): BucketObject {
  return {
    key,
    size: bytes.length,
    httpEtag: '"abc"',
    body: new Response(bytes).body!,
    writeHttpMetadata: () => {},
    ...extra,
  };
}

const bucketOf = (objects: Record<string, () => BucketObject>): Bucket => ({
  get: async (key) => objects[key]?.() ?? null,
  head: async (key) => {
    const o = objects[key]?.();
    return o === undefined ? null : { ...o, body: undefined };
  },
});

const get = (path: string, init: RequestInit = {}) =>
  new Request(`https://site.example/dl/${path}`, init);

describe("keyOf", () => {
  test("joins path segments into a key", () => {
    expect(keyOf(["download", "v1.2.3", "jint-linux-x64.tar.gz"])).toBe(
      "download/v1.2.3/jint-linux-x64.tar.gz",
    );
  });
  test("refuses traversal-shaped and empty paths", () => {
    expect(keyOf(["download", "..", "secret"])).toBeNull();
    expect(keyOf(["a", "", "b"])).toBeNull();
    expect(keyOf([])).toBeNull();
    expect(keyOf(undefined)).toBeNull();
    expect(keyOf(["a\\b"])).toBeNull();
  });
});

describe("serveObject", () => {
  const key = "download/v1.2.3/jint-linux-x64.tar.gz";
  const bucket = bucketOf({
    [key]: () => object(key),
    "latest/download/checksums.txt": () => object("latest/download/checksums.txt"),
  });

  test("a release asset is served as a download, immutable for a year", async () => {
    const res = await serveObject(get(key), bucket, key);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0123456789");
    expect(res.headers.get("content-type")).toBe("application/gzip");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="jint-linux-x64.tar.gz"',
    );
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("etag")).toBe('"abc"');
  });

  test("the latest alias caches for a minute and checksums read as text", async () => {
    const k = "latest/download/checksums.txt";
    const res = await serveObject(get(k), bucket, k);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("content-disposition")).toBeNull();
  });

  test("the beta channel is overwritten in place, so it caches for a minute, not forever", async () => {
    const k = "download/beta/jint-linux-x64.tar.gz";
    const res = await serveObject(get(k), bucketOf({ [k]: () => object(k) }), k);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("content-disposition")).toContain("jint-linux-x64.tar.gz");
  });

  test("a range request is a 206 with its content-range", async () => {
    const ranged = bucketOf({
      [key]: () =>
        object(key, { range: { offset: 2, length: 4 }, body: new Response("2345").body! }),
    });
    const res = await serveObject(get(key, { headers: { range: "bytes=2-5" } }), ranged, key);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("2345");
  });

  test("a met precondition is a 304 with no body", async () => {
    const cached = bucketOf({ [key]: () => object(key, { body: undefined }) });
    const res = await serveObject(get(key, { headers: { "if-none-match": '"abc"' } }), cached, key);
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  test("HEAD answers the headers without a body", async () => {
    const res = await serveObject(get(key, { method: "HEAD" }), bucket, key);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("10");
    expect(await res.text()).toBe("");
  });

  test("a missing key is a 404 and a write method is a 405", async () => {
    expect((await serveObject(get("nope"), bucket, "nope")).status).toBe(404);
    const res = await serveObject(get(key, { method: "POST" }), bucket, key);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });
});
