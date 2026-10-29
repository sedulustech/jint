import { describe, expect, test } from "bun:test";
import { SetupError } from "../types.ts";
import { DEFAULT_URL, assertEndpointKey, resolveEndpoint } from "./endpoint.ts";

const JINT = "https://jint.test/v1/decisions";

describe("resolveEndpoint: the key you export picks the destination", () => {
  test("only OPENAI_API_KEY: the default url, that key", () => {
    const r = resolveEndpoint({}, { OPENAI_API_KEY: "o" });
    expect(r).toMatchObject({ url: DEFAULT_URL, apiKey: "o", notes: ["key from OPENAI_API_KEY"] });
  });

  test("only JINT_API_KEY with JINT_API_URL: that url, that key", () => {
    const r = resolveEndpoint({}, { JINT_API_KEY: "j", JINT_API_URL: JINT });
    expect(r.url).toBe(JINT);
    expect(r.apiKey).toBe("j");
    expect(r.notes).toEqual(["url overridden, host jint.test", "key from JINT_API_KEY"]);
  });

  test("both keys: JINT_API_KEY wins", () => {
    const r = resolveEndpoint({}, { OPENAI_API_KEY: "o", JINT_API_KEY: "j", JINT_API_URL: JINT });
    expect(r).toMatchObject({ url: JINT, apiKey: "j" });
  });

  test("a custom url with only OPENAI_API_KEY: the key is withheld, and the message says why", () => {
    const r = resolveEndpoint({}, { OPENAI_API_KEY: "o", JINT_API_URL: JINT });
    expect(r.apiKey).toBeUndefined();
    expect(r.unusable).toMatch(
      /jint\.test.*OPENAI_API_KEY only goes to api\.openai\.com.*JINT_API_KEY/,
    );
  });

  test("the OpenAI key may be paired with its own url spelled out", () => {
    const r = resolveEndpoint({}, { OPENAI_API_KEY: "o", JINT_API_URL: DEFAULT_URL });
    expect(r.apiKey).toBe("o");
  });

  test("JINT_API_KEY with no url anywhere: no usable key, naming JINT_API_URL", () => {
    const r = resolveEndpoint({}, { JINT_API_KEY: "j", OPENAI_API_KEY: "o" });
    expect(r.apiKey).toBeUndefined();
    expect(r.unusable).toMatch(/JINT_API_KEY is set but no url.*JINT_API_URL/);
  });

  test("neither key: no usable key, naming both variables and the config key", () => {
    const r = resolveEndpoint({}, {});
    expect(r).toMatchObject({ url: DEFAULT_URL, apiKey: undefined, notes: [] });
    expect(r.unusable).toMatch(/JINT_API_KEY or OPENAI_API_KEY.*apiKey/);
  });

  test("an empty variable is unset", () => {
    const r = resolveEndpoint({}, { JINT_API_KEY: "", OPENAI_API_KEY: "o", JINT_API_URL: "" });
    expect(r).toMatchObject({ url: DEFAULT_URL, apiKey: "o" });
  });
});

describe("resolveEndpoint: config overrides the run", () => {
  test("config apiKey beats every environment key and asks the default url without one", () => {
    const env = { JINT_API_KEY: "j", OPENAI_API_KEY: "o", JINT_API_URL: JINT };
    expect(resolveEndpoint({ apiKey: "cfg" }, env)).toMatchObject({ url: JINT, apiKey: "cfg" });
    expect(resolveEndpoint({ apiKey: "cfg" }, {})).toMatchObject({
      url: DEFAULT_URL,
      apiKey: "cfg",
    });
    expect(resolveEndpoint({ apiKey: "" }, {}).apiKey).toBeUndefined();
  });

  test("config url beats JINT_API_URL; the key still has to be paired with it", () => {
    const env = { JINT_API_KEY: "j", JINT_API_URL: JINT };
    expect(resolveEndpoint({ url: "https://cfg.test/y/decisions" }, env).url).toBe(
      "https://cfg.test/y/decisions",
    );
    expect(
      resolveEndpoint({ url: "https://cfg.test/y/decisions" }, { OPENAI_API_KEY: "o" }).apiKey,
    ).toBeUndefined();
  });

  test("notes name where settings came from and never a secret", () => {
    const r = resolveEndpoint(
      {},
      {
        JINT_API_URL: "https://user:pw-secret@example.test:8443/v1/path?token=q-secret",
        JINT_API_KEY: "key-secret",
      },
    );
    expect(r.notes).toEqual(["url overridden, host example.test:8443", "key from JINT_API_KEY"]);
    expect(JSON.stringify(r.notes)).not.toMatch(/secret|user|pw/);
    expect(resolveEndpoint({ apiKey: "cfg-secret", url: "https://cfg.test/p" }, {}).notes).toEqual([
      "url overridden, host cfg.test",
    ]);
  });
});

describe("resolveEndpoint: removed variables", () => {
  test("provider, model and per-vendor key variables are never read", () => {
    const removed = {
      JINT_PROVIDER: "x",
      JINT_PROVIDER_URL: JINT,
      JINT_PROVIDER_KEY: "x",
      JINT_MODEL: "x",
      JINT_OPENAI_API_KEY: "x",
      JINT_AI_GATEWAY_API_KEY: "x",
      AI_GATEWAY_API_KEY: "x",
    };
    expect(resolveEndpoint({}, removed)).toMatchObject({ url: DEFAULT_URL, apiKey: undefined });
  });
});

describe("assertEndpointKey", () => {
  test("a run with no usable key fails at setup with the reason", () => {
    const saved = { ...process.env };
    delete process.env.JINT_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      let thrown: unknown;
      try {
        assertEndpointKey({});
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SetupError);
      expect((thrown as SetupError).message).toMatch(/JINT_API_KEY or OPENAI_API_KEY.*apiKey/);
      expect(() => assertEndpointKey({ apiKey: "k" })).not.toThrow();
    } finally {
      process.env = saved;
    }
  });
});
