import { describe, expect, test } from "bun:test";
import { ClassifyError, type Ask } from "../types.ts";
import { GEMINI_MODEL, GEMINI_URL, geminiAdapter } from "./gemini.ts";
import type { Endpoint } from "./endpoint.ts";
import type { Fetch } from "./protocol.ts";

const GOOGLE: Endpoint = {
  url: GEMINI_URL,
  protocol: "gemini",
  model: undefined,
  apiKey: "g-key",
  notes: [],
};
const ASK: Ask = {
  state: { path: "a.md", content: "The mug arrived cracked.", includePath: false },
  questions: {
    damaged: {
      type: "noul",
      instructions: "Did it arrive damaged?",
      criteria: { true: "It is damaged.", false: "It is intact." },
    },
    queue: {
      type: "choice",
      instructions: "Which queue?",
      criteria: { billing: "Money.", replacements: "Broken items." },
    },
  },
};
const REPLY = {
  answers: {
    q0: { type: "noul", noul: 0.97, confidence: 0.97 },
    q1: {
      type: "choice",
      choice: "replacements",
      probabilities: { billing: 0.1, replacements: 0.9 },
      confidence: 0.9,
    },
  },
  usage: { total_input_tokens: 122, total_output_tokens: 0, total_tokens: 122 },
};

/** A fake Gemini server: records what it was sent and answers with the given body. */
function fake(reply: unknown, status = 200) {
  const sent: { url: string; body: any; headers: Headers }[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return Response.json(reply, { status });
  };
  return { sent, fetch };
}
const over = (fetch: Fetch, endpoint = GOOGLE) =>
  geminiAdapter(endpoint, { fetch, log: () => {}, limits: { timeoutMs: 5_000, maxRetries: 0 } });

describe("gemini adapter", () => {
  test("the request: Google's path, the key in x-goog-api-key, the state as text, questions by question key, noul criteria renamed", async () => {
    const server = fake(REPLY);
    await over(server.fetch).ask(ASK);
    const [call] = server.sent;
    expect(call!.url).toBe(GEMINI_URL);
    expect(call!.headers.get("x-goog-api-key")).toBe("g-key");
    expect(call!.headers.get("Authorization")).toBeNull();
    expect(call!.body.model).toBe(GEMINI_MODEL);
    expect(JSON.parse(call!.body.input)).toEqual({ content: "The mug arrived cracked." });
    expect(call!.body.questions.q0.criteria).toEqual({
      true_description: "It is damaged.",
      false_description: "It is intact.",
    });
    expect(call!.body.questions.q1.criteria).toEqual({
      billing: "Money.",
      replacements: "Broken items.",
    });
  });

  test("the reply: answers read by name, the asked model, input tokens from total_input_tokens", async () => {
    const asked = await over(fake(REPLY).fetch).ask(ASK);
    expect(asked.model).toBe(GEMINI_MODEL);
    expect(asked.answers.damaged).toEqual({ value: 0.97 });
    expect(asked.answers.queue).toMatchObject({ value: 0.9, choice: "replacements" });
    expect(asked.usage.input_tokens).toBe(122);
  });

  test("a 400, a safety block included, fails the call naming the block", async () => {
    const blocked = { error: { code: "safety", message: "blocked for safety" } };
    const call = over(fake(blocked, 400).fetch).ask(ASK);
    expect(call).rejects.toBeInstanceOf(ClassifyError);
    expect(call).rejects.toThrow(/blocked for safety/);
  });

  test("a url off Google's path fails at setup", () => {
    expect(() => over(fake(REPLY).fetch, { ...GOOGLE, url: "https://x.test/v1/decide" })).toThrow(
      /must end in \/v1beta\/decisions/,
    );
  });
});
