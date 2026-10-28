import { describe, expect, test } from "bun:test";
import { normalizeRequestFile } from "./request-file.ts";

const STATE = { path: "a.ts", content: "x" };

const legacy = {
  ts: "t",
  url: "https://api.typesafe.ai/v1/systemone",
  id: "L1",
  request: {
    state: { ...STATE, id: "L1" },
    questions: { "r in L1": { type: "noul", instructions: "Is it?" } },
    model: "jev",
  },
  status: 200,
  response: { model: "jev", answers: { "r in L1": { type: "noul", noul: 0.4 } } },
  wire: { url: "https://x/y", body: { a: 1 } },
};

const decisions = {
  ts: "t",
  url: "https://api.openai.com/v1/decisions",
  id: "L1",
  questionIds: ["p in L1", "s in L1", "c in L1", "refused in L1"],
  durationMs: 7,
  status: 200,
  request: {
    model: "gpt-6-luna",
    input: [{ role: "user", content: [{ type: "input_json", data: STATE }] }],
    questions: [
      { type: "predicate", name: "q0", instructions: "Is it?\n\nYes: a\nNo: b" },
      {
        type: "score",
        name: "q1",
        instructions: "How?",
        levels: [
          { label: "0", description: "low" },
          { label: "1", description: "high" },
        ],
      },
      {
        type: "choice",
        name: "q2",
        instructions: "Which?",
        choices: [
          { value: "a", description: "A" },
          { value: "none_of_these", description: "None of these fits" },
        ],
      },
      { type: "predicate", name: "q3", instructions: "Refused?" },
    ],
  },
  response: {
    model: "gpt-6-luna",
    answers: [
      { type: "predicate", name: "q0", probability: 0.2 },
      {
        type: "score",
        name: "q1",
        probabilities: [
          { value: "0", probability: 0.25 },
          { value: "1", probability: 0.75 },
        ],
      },
      {
        type: "choice",
        name: "q2",
        choice: "a",
        probabilities: [
          { value: "a", probability: 0.6 },
          { value: "none_of_these", probability: 0.2 },
        ],
      },
      { type: "refusal", name: "q3" },
    ],
    usage: { input_tokens: 9, output_tokens: 1, input_tokens_details: { cached_tokens: 4 } },
  },
};

describe("normalizeRequestFile", () => {
  test("a legacy file passes through untouched", () => {
    expect(normalizeRequestFile(legacy)).toBe(legacy as never);
  });

  test("a decisions file becomes the view model: questions and answers keyed by question id", () => {
    const file = normalizeRequestFile(decisions);
    expect(file.request?.state).toEqual(STATE);
    expect(file.request?.model).toBe("gpt-6-luna");
    expect(file.request?.questions).toEqual({
      "p in L1": { type: "noul", instructions: "Is it?\n\nYes: a\nNo: b" },
      "s in L1": { type: "score", instructions: "How?", criteria: ["low", "high"] },
      "c in L1": { type: "choice", instructions: "Which?", criteria: { a: "A" } },
      "refused in L1": { type: "noul", instructions: "Refused?" },
    });
    expect(file.response?.answers).toEqual({
      "p in L1": { type: "noul", noul: 0.2 },
      "s in L1": {
        type: "score",
        score: 0.75,
        legend: { "0": "low", "1": "high" },
        probabilities: { "0": 0.25, "1": 0.75 },
      },
      "c in L1": { type: "choice", choice: "a", probabilities: { a: 1 } },
      "refused in L1": { type: "refusal" },
    });
    expect(file.response?.usage).toEqual({
      input_tokens: 9,
      output_tokens: 1,
      cached_input_tokens: 4,
    });
  });

  test("the request toggle's body is the record's own request", () => {
    const file = normalizeRequestFile(decisions);
    expect(file.wire?.body).toBe(decisions.request as never);
    expect(file.wire?.response).toBe(decisions.response as never);
    expect([file.id, file.durationMs, file.status]).toEqual(["L1", 7, 200]);
  });

  test("a string input holding JSON is the state; questions without ids keep their names", () => {
    const file = normalizeRequestFile({
      ...decisions,
      questionIds: undefined,
      request: { ...decisions.request, input: JSON.stringify(STATE) },
    });
    expect(file.request?.state).toEqual(STATE);
    expect(Object.keys(file.request?.questions ?? {})).toEqual(["q0", "q1", "q2", "q3"]);
  });

  test("a recorded score or choice answer keeps the provider's confidence; none stays none", () => {
    const answers = decisions.response.answers.map((a) =>
      a.type === "score" || a.type === "choice" ? { ...a, confidence: 0.36 } : a,
    );
    const file = normalizeRequestFile({
      ...decisions,
      response: { ...decisions.response, answers },
    });
    const read = file.response?.answers;
    expect(read?.["s in L1"]?.confidence).toBe(0.36);
    expect(read?.["c in L1"]?.confidence).toBe(0.36);
    expect(read?.["p in L1"]).not.toHaveProperty("confidence");
    const plain = normalizeRequestFile(decisions).response?.answers;
    expect(plain?.["s in L1"]).not.toHaveProperty("confidence");
    expect(plain?.["c in L1"]).not.toHaveProperty("confidence");
  });

  const native = {
    ts: "t",
    url: "https://ai-gateway.vercel.sh/v4/ai/decision-model",
    id: "L1",
    questionIds: ["p in L1", "s in L1", "c in L1", "refused in L1"],
    durationMs: 9,
    status: 200,
    request: {
      stateParts: [{ type: "text", text: JSON.stringify(STATE) }],
      questions: {
        q0: { type: "boolean", instructions: "Is it?\n\nYes: a\nNo: b" },
        q1: { type: "score", instructions: "How?", criteria: ["low", "high"] },
        q2: {
          type: "choice",
          instructions: "Which?",
          criteria: { a: "A", none_of_these: "None of these fits" },
        },
        q3: { type: "boolean", instructions: "Refused?" },
      },
    },
    response: {
      model: "gpt-6-luna",
      answers: {
        q0: { type: "boolean", probability: 0.2 },
        q1: { type: "score", probabilities: { "0": 0.25, "1": 0.75 } },
        q2: { type: "choice", choice: "a", probabilities: { a: 0.6, none_of_these: 0.2 } },
        q3: { type: "refusal" },
      },
      usage: { inputTokens: 9, outputTokens: 1 },
      providerMetadata: { openai: { usage: { input_tokens_details: { cached_tokens: 4 } } } },
    },
  };

  test("a decision-model file reads like the decisions one: same view model, the gateway's usage", () => {
    const file = normalizeRequestFile(native);
    const same = normalizeRequestFile(decisions);
    expect(file.request?.state).toEqual(STATE);
    expect(file.request?.questions).toEqual(same.request?.questions);
    expect(file.response?.answers).toEqual(same.response?.answers);
    expect(file.response?.model).toBe("gpt-6-luna");
    expect(file.response?.usage).toEqual({
      input_tokens: 9,
      output_tokens: 1,
      cached_input_tokens: 4,
    });
    expect(file.wire?.body).toBe(native.request as never);
    expect([file.id, file.durationMs, file.status]).toEqual(["L1", 9, 200]);
  });
});
