import { describe, expect, test } from "bun:test";
import { SetupError } from "../types.ts";
import { DEFAULT_URL, assertEndpointKey, resolveEndpoint, urlIdentity } from "./endpoint.ts";

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

  test("neither key: no usable key, naming both variables", () => {
    const r = resolveEndpoint({}, {});
    expect(r).toMatchObject({ url: DEFAULT_URL, apiKey: undefined, notes: [] });
    expect(r.unusable).toBe("no API key set - export JINT_API_KEY or OPENAI_API_KEY");
  });

  test("an empty variable is unset", () => {
    const r = resolveEndpoint({}, { JINT_API_KEY: "", OPENAI_API_KEY: "o", JINT_API_URL: "" });
    expect(r).toMatchObject({ url: DEFAULT_URL, apiKey: "o" });
  });
});

describe("resolveEndpoint: a caller of the SDK overrides the run", () => {
  test("a passed apiKey beats every environment key and asks the default url without one", () => {
    const env = { JINT_API_KEY: "j", OPENAI_API_KEY: "o", JINT_API_URL: JINT };
    expect(resolveEndpoint({ apiKey: "cfg" }, env)).toMatchObject({ url: JINT, apiKey: "cfg" });
    expect(resolveEndpoint({ apiKey: "cfg" }, {})).toMatchObject({
      url: DEFAULT_URL,
      apiKey: "cfg",
    });
    expect(resolveEndpoint({ apiKey: "" }, {}).apiKey).toBeUndefined();
  });

  test("a passed url beats JINT_API_URL; the key still has to be paired with it", () => {
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

describe("resolveEndpoint: the url picks the wire", () => {
  test("no url: OpenAI's Decisions endpoint, whatever the model setting", () => {
    expect(resolveEndpoint({}, { OPENAI_API_KEY: "k" })).toMatchObject({
      protocol: "decisions",
      url: DEFAULT_URL,
      model: undefined,
    });
  });
  test("a url ending in /systemone is the System One wire, a /decisions one is Decisions", () => {
    const env = { JINT_API_KEY: "k" };
    const at = (url: string) => resolveEndpoint({ url }, env).protocol;
    expect(at("https://api.example.test/v1/systemone")).toBe("systemone");
    expect(at("https://api.example.test/v1/systemone/")).toBe("systemone");
    expect(at("https://api.example.test/v1/decisions")).toBe("decisions");
  });
  test("JINT_API_MODEL names the model; a caller's model wins; empty is unset", () => {
    const env = { JINT_API_KEY: "k", JINT_API_URL: "https://x.test/v1/systemone" };
    expect(resolveEndpoint({}, { ...env, JINT_API_MODEL: "d3-lite-FLM" }).model).toBe(
      "d3-lite-FLM",
    );
    expect(
      resolveEndpoint({ model: "other" }, { ...env, JINT_API_MODEL: "d3-lite-FLM" }).model,
    ).toBe("other");
    expect(resolveEndpoint({}, { ...env, JINT_API_MODEL: "" }).model).toBeUndefined();
  });
});

describe("resolveEndpoint: a server on this machine may go without a key", () => {
  test.each(["http://localhost:13305/v1/systemone", "http://127.0.0.1:13305/v1/systemone"])(
    "%s runs keyless, and an exported OpenAI key is never sent there",
    (url) => {
      const asked = resolveEndpoint({}, { JINT_API_URL: url, OPENAI_API_KEY: "sk-openai" });
      expect(asked).toMatchObject({ keyless: true, apiKey: undefined });
      expect(asked.unusable).toBeUndefined();
    },
  );
  test("a key that is set still goes", () => {
    const asked = resolveEndpoint(
      {},
      { JINT_API_URL: "http://localhost:13305/v1/systemone", JINT_API_KEY: "secret" },
    );
    expect(asked).toMatchObject({ apiKey: "secret" });
    expect(asked.keyless).toBeUndefined();
  });
  test("another host, or a Decisions url, still needs a key", () => {
    for (const url of [
      "https://api.example.test/v1/systemone",
      "http://localhost:8080/v1/decisions",
    ]) {
      const asked = resolveEndpoint({}, { JINT_API_URL: url });
      expect(asked.apiKey).toBeUndefined();
      expect(asked.keyless).toBeUndefined();
      expect(asked.unusable).toContain("no API key");
    }
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
      expect((thrown as SetupError).message).toBe(
        "no API key set - export JINT_API_KEY or OPENAI_API_KEY",
      );
      expect(() => assertEndpointKey({ apiKey: "k" })).not.toThrow();
    } finally {
      process.env = saved;
    }
  });
});

describe("urlIdentity", () => {
  test("names scheme, host and path; a credential in userinfo or query never counts", () => {
    const named = urlIdentity("https://gw.test/a/v1/decisions");
    expect(named).toBe("https://gw.test/a/v1/decisions");
    expect(urlIdentity("https://user:pw@gw.test/a/v1/decisions?token=q")).toBe(named);
    expect(urlIdentity("https://gw.test/b/v1/decisions")).not.toBe(named);
    expect(urlIdentity("not a url")).toBe("unparseable");
  });
});
