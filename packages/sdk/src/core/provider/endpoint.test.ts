import { describe, expect, test } from "bun:test";
import { SetupError } from "../types.ts";
import { DEFAULT_URL, assertEndpointKey, resolveEndpoint } from "./endpoint.ts";

describe("resolveEndpoint", () => {
  test("with nothing set: the default url, no key", () => {
    const r = resolveEndpoint({}, {});
    expect(r.url).toBe("https://api.openai.com/v1/decisions");
    expect(r.apiKey).toBeUndefined();
    expect(r.notes).toEqual([]);
  });

  test("url: config beats JINT_PROVIDER_URL beats the default; empty is unset", () => {
    const env = { JINT_PROVIDER_URL: "https://env.test/x" };
    expect(resolveEndpoint({}, env).url).toBe("https://env.test/x");
    expect(resolveEndpoint({ url: "https://cfg.test/y" }, env).url).toBe("https://cfg.test/y");
    expect(resolveEndpoint({}, { JINT_PROVIDER_URL: "" }).url).toBe(DEFAULT_URL);
    expect(resolveEndpoint({ url: "" }, env).url).toBe("https://env.test/x");
  });

  test("key: config beats JINT_PROVIDER_KEY; vendor and removed variables are never read", () => {
    expect(resolveEndpoint({}, { JINT_PROVIDER_KEY: "env" }).apiKey).toBe("env");
    expect(resolveEndpoint({ apiKey: "cfg" }, { JINT_PROVIDER_KEY: "env" }).apiKey).toBe("cfg");
    expect(resolveEndpoint({ apiKey: "" }, { JINT_PROVIDER_KEY: "" }).apiKey).toBeUndefined();
    const stray = { OPENAI_API_KEY: "x", AI_GATEWAY_API_KEY: "y", JINT_OPENAI_API_KEY: "z" };
    expect(resolveEndpoint({}, stray).apiKey).toBeUndefined();
  });

  test("notes name an override by host, never a path, userinfo or key", () => {
    expect(resolveEndpoint({}, { JINT_PROVIDER_URL: DEFAULT_URL }).notes).toEqual([]);
    const r = resolveEndpoint(
      {},
      {
        JINT_PROVIDER_URL: "https://user:pw-secret@example.test:8443/v1/path?token=q-secret",
        JINT_PROVIDER_KEY: "key-secret",
      },
    );
    expect(r.notes).toEqual([
      "url overridden, host example.test:8443",
      "key from JINT_PROVIDER_KEY",
    ]);
    const all = r.notes.join("\n");
    for (const secret of ["key-secret", "pw-secret", "q-secret", "user", "/v1/path"]) {
      expect(all).not.toContain(secret);
    }
    // a config url off the default is noted too; a config key is not an env override
    const cfg = resolveEndpoint(
      { apiKey: "cfg-secret", url: "https://cfg.test/p" },
      { JINT_PROVIDER_KEY: "ignored" },
    );
    expect(cfg.notes).toEqual(["url overridden, host cfg.test"]);
  });
});

describe("assertEndpointKey", () => {
  test("a missing key names JINT_PROVIDER_KEY and the config key", () => {
    const saved = process.env.JINT_PROVIDER_KEY;
    delete process.env.JINT_PROVIDER_KEY;
    try {
      let thrown: unknown;
      try {
        assertEndpointKey({});
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SetupError);
      expect((thrown as SetupError).message).toMatch(/JINT_PROVIDER_KEY.*apiKey/);
      expect(() => assertEndpointKey({ apiKey: "k" })).not.toThrow();
    } finally {
      if (saved !== undefined) process.env.JINT_PROVIDER_KEY = saved;
    }
  });
});
