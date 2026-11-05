import { describe, expect, test } from "bun:test";
import {
  keyOf,
  serveCached,
  serveObject,
  type Bucket,
  type BucketObject,
  type EdgeCache,
} from "./dl.ts";

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

  test("the latest alias revalidates on every use and checksums read as text", async () => {
    const k = "latest/download/checksums.txt";
    const res = await serveObject(get(k), bucket, k);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("content-disposition")).toBeNull();
  });

  test("the beta pointer is overwritten in place, so a cache revalidates it every time", async () => {
    const k = "download/beta/COMMIT";
    const res = await serveObject(get(k), bucketOf({ [k]: () => object(k) }), k);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  test("a versioned beta build is immutable", async () => {
    const k = "download/beta-a1b2c3/jint-linux-x64.tar.gz";
    const res = await serveObject(get(k), bucketOf({ [k]: () => object(k) }), k);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-disposition")).toContain("jint-linux-x64.tar.gz");
  });

  test("a beta asset redirects to the build the pointer names, never cached", async () => {
    const pointer = "download/beta/COMMIT";
    const bucket = bucketOf({
      [pointer]: () => object(pointer, { body: new Response("a1b2c3d4e5f6\n").body! }),
    });
    const k = "download/beta/checksums.txt";
    const res = await serveObject(get(k), bucket, k);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dl/download/beta-a1b2c3/checksums.txt");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  test("a beta asset with no pointer is a 404", async () => {
    const k = "download/beta/checksums.txt";
    expect((await serveObject(get(k), bucketOf({}), k)).status).toBe(404);
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

  test("a read with no Range header is a 200 even when the bucket reports a range", async () => {
    const reports = bucketOf({
      [key]: () => object(key, { range: { offset: 0, length: 10 } }),
    });
    const res = await serveObject(get(key), reports, key);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-range")).toBeNull();
    expect(res.headers.get("content-length")).toBe("10");
  });

  test("HEAD is a 200 even when it sends a Range header", async () => {
    const reports = bucketOf({
      [key]: () => object(key, { range: { offset: 0, length: 4 } }),
    });
    const res = await serveObject(
      get(key, { method: "HEAD", headers: { range: "bytes=0-3" } }),
      reports,
      key,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-range")).toBeNull();
    expect(res.headers.get("content-length")).toBe("10");
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

describe("serveCached", () => {
  const immutable = "download/beta-a1b2c3/jint-linux-x64.tar.gz";

  /** A bucket that counts reads, an edge cache keyed by URL, and the work waitUntil was handed. */
  function rig() {
    let reads = 0;
    const bucket: Bucket = {
      get: async (k, options) => {
        reads += 1;
        if (k !== immutable && k !== "download/beta/COMMIT") return null;
        // like R2: a read handed a Range header reports the range it served
        return options?.range?.has("range")
          ? object(k, { range: { offset: 0, length: 4 }, body: new Response("0123").body! })
          : object(k);
      },
      head: async (k) => (k === immutable ? { ...object(k), body: undefined } : null),
    };
    const stored = new Map<string, Response>();
    const cache: EdgeCache = {
      match: async (r) => stored.get(r.url)?.clone(),
      put: async (r, res) => {
        stored.set(r.url, res);
      },
    };
    const pending: Promise<unknown>[] = [];
    const call = (path: string, init: RequestInit = {}) =>
      serveCached(get(path, init), bucket, path, cache, (w) => pending.push(w));
    return { call, stored, reads: () => reads, settle: () => Promise.all(pending) };
  }

  test("a miss answers from the bucket and stores the response; the next GET never reads the bucket", async () => {
    const r = rig();
    const first = await r.call(immutable);
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("0123456789");
    await r.settle();
    expect(r.stored.size).toBe(1);
    const second = await r.call(immutable);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("0123456789");
    expect(r.reads()).toBe(1);
  });

  test("a range request, a HEAD, the pointer and a missing object are never stored", async () => {
    const r = rig();
    await r.call(immutable, { headers: { range: "bytes=0-3" } });
    await r.call(immutable, { method: "HEAD" });
    await r.call("download/beta/COMMIT");
    await r.call("download/beta-a1b2c3/missing.tar.gz");
    await r.settle();
    expect(r.stored.size).toBe(0);
  });
});
