import { describe, expect, test } from "bun:test";
import { SetupError } from "../types.ts";
import { PROVIDERS, assertProviderKey, resolveProvider } from "./providers.ts";

const NO_ENV = {};

describe("resolveProvider", () => {
  test("with nothing set: openai, its model, no key", () => {
    const r = resolveProvider({}, NO_ENV);
    expect(r.name).toBe("openai");
    expect(r.spec).toMatchObject({ protocol: "decisions", keyEnv: "JINT_OPENAI_API_KEY" });
    expect(r.model).toBe("gpt-6-luna");
    expect(r.apiKey).toBeUndefined();
  });

  test("provider: config beats JINT_PROVIDER beats the default", () => {
    expect(resolveProvider({}, { JINT_PROVIDER: "vercel" }).name).toBe("vercel");
    expect(resolveProvider({ provider: "systemone" }, { JINT_PROVIDER: "vercel" }).name).toBe(
      "systemone",
    );
  });

  test("model: config beats JINT_MODEL beats the provider's model", () => {
    const env = { JINT_PROVIDER: "vercel", JINT_MODEL: "from-env" };
    expect(resolveProvider({}, { JINT_PROVIDER: "vercel" }).model).toBe(PROVIDERS.vercel!.model);
    expect(resolveProvider({}, env).model).toBe("from-env");
    expect(resolveProvider({ model: "from-config" }, env).model).toBe("from-config");
  });

  test("key: config apiKey beats the provider's keyEnv; other providers' variables are ignored", () => {
    const env = { JINT_OPENAI_API_KEY: "env-key", JINT_AI_GATEWAY_API_KEY: "gw-key" };
    expect(resolveProvider({}, env).apiKey).toBe("env-key");
    expect(resolveProvider({ apiKey: "cfg" }, env).apiKey).toBe("cfg");
    expect(resolveProvider({ provider: "vercel" }, env).apiKey).toBe("gw-key");
    // bare vendor variables collide with other tools: never read
    expect(
      resolveProvider({}, { OPENAI_API_KEY: "x", TYPESAFE_API_KEY: "y" }).apiKey,
    ).toBeUndefined();
    // empty counts as unset
    expect(resolveProvider({ apiKey: "" }, { JINT_OPENAI_API_KEY: "" }).apiKey).toBeUndefined();
  });

  test("an unknown provider is a setup error listing the known names", () => {
    let thrown: unknown;
    try {
      resolveProvider({ provider: "nope", providers: { mine: { protocol: "decisions" } } }, NO_ENV);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SetupError);
    expect((thrown as SetupError).code).toBe("CONFIG_INVALID");
    expect((thrown as SetupError).message).toContain("'nope'");
    expect((thrown as SetupError).message).toContain("openai, vercel, systemone, mine");
  });

  test("an override merges field by field over the table entry, limits included", () => {
    const r = resolveProvider(
      { providers: { openai: { url: "http://127.0.0.1:1/v1/decisions", headers: { a: "b" } } } },
      NO_ENV,
    );
    expect(r.spec).toEqual({
      ...PROVIDERS.openai!,
      url: "http://127.0.0.1:1/v1/decisions",
      headers: { a: "b" },
    });
    const limited = resolveProvider({ providers: { openai: { limits: {} } } }, NO_ENV);
    expect(limited.spec.limits).toEqual({ tokensPerMinute: 10_000_000 });
    expect(PROVIDERS.openai!.url).toBe("https://api.openai.com/v1/decisions");
  });

  test("a new provider needs protocol, url, keyEnv and model; a bad protocol is named", () => {
    const mine = { protocol: "decisions", url: "http://x", keyEnv: "MY_KEY", model: "m" } as const;
    const r = resolveProvider({ provider: "mine", providers: { mine } }, { MY_KEY: "k" });
    expect(r).toMatchObject({ name: "mine", model: "m", apiKey: "k" });
    expect(() =>
      resolveProvider({ provider: "mine", providers: { mine: { url: "http://x" } } }, NO_ENV),
    ).toThrow(/incomplete: set protocol, keyEnv, model/);
    expect(() =>
      resolveProvider(
        { provider: "mine", providers: { mine: { ...mine, protocol: "soap" as never } } },
        NO_ENV,
      ),
    ).toThrow(/unknown protocol 'soap'/);
  });
});

describe("assertProviderKey", () => {
  test("a missing key names the selected provider's keyEnv", () => {
    const saved = process.env.JINT_AI_GATEWAY_API_KEY;
    delete process.env.JINT_AI_GATEWAY_API_KEY;
    try {
      expect(() => assertProviderKey({ provider: "vercel" })).toThrow(
        /no JINT_AI_GATEWAY_API_KEY set/,
      );
      expect(() => assertProviderKey({ provider: "vercel", apiKey: "k" })).not.toThrow();
    } finally {
      if (saved !== undefined) process.env.JINT_AI_GATEWAY_API_KEY = saved;
    }
  });
});
