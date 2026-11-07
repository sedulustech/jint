import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decisionsParams, MODEL } from "../core/provider/decisions.ts";
import { classifiedState } from "../core/rules/classify.ts";
import { serveApiRequest } from "./api.ts";
import { classifyEdited, parseClassifyRequest, viewAnswer } from "./classify.ts";
import type { Classifier } from "../core/types.ts";

const body = {
  state: { path: "a.ts", source: "function f() {}" },
  question: {
    type: "noul",
    instructions: "Is it small?",
    criteria: { true: "Small.", false: "Big." },
  },
};

describe("a try of an unedited recording", () => {
  test("goes out as the same wire body the recording was", async () => {
    // a recorded element request: the path leads, one predicate whose text folds the criteria
    // (the classifier keeps the id off the wire, so the bodies are built without it)
    const wire = (state: Parameters<Classifier>[0], name: string, question: unknown) => {
      const { id: _id, ...sent } = state;
      return decisionsParams(MODEL, { state: sent, questions: { [name]: question } } as never);
    };
    const recorded = wire(
      classifiedState({ path: "a.ts", source: "function f() {}", id: "e1" }, true),
      "r",
      body.question,
    );
    // the run view hands back the state and question the way the recording stored them, and the
    // try classifies them; the state the classifier is asked about is the one the run would build
    let asked: Parameters<Classifier>[0] | undefined;
    const classifier: Classifier = async (state, questions) => {
      asked = state;
      return Object.fromEntries(Object.keys(questions).map((name) => [name, { value: 0.5 }]));
    };
    const shown = parseClassifyRequest({
      state: { source: "function f() {}", path: "a.ts" },
      question: body.question,
    });
    if (typeof shown === "string") throw new Error(shown);
    await classifyEdited(shown, { classifier });
    const tried = wire(asked!, "edited", shown.question);
    expect(JSON.stringify(tried)).toBe(JSON.stringify(recorded));
  });
});

const root = mkdtempSync(join(tmpdir(), "jint-tries-"));
mkdirSync(join(root, "run-a"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const post = (payload: unknown, headers: Record<string, string> = {}, run = "run-a") =>
  new Request(`http://localhost:1/api/runs/${run}/tries`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:1", ...headers },
    body: JSON.stringify(payload),
  });
const address = { rule: "is_small", input: "a.ts#e1" };
const list = async (query = "rule=is_small&input=a.ts%23e1") =>
  (await (
    await serveApiRequest(new Request(`http://localhost:1/api/runs/run-a/tries?${query}`), { root })
  )?.json()) as { tries: { seq: number; answer: unknown; question: { instructions: string } }[] };

describe("tries under a run", () => {
  test("a try classifies the edit, files it under the run, and lists back oldest first", async () => {
    const classifier: Classifier = async () => ({ edited: { value: 0.9 } }) as never;
    const first = await serveApiRequest(post({ ...body, ...address }), { root, classifier });
    expect(first?.status).toBe(200);
    const filed = ((await first?.json()) as { try: { seq: number; answer: unknown } }).try;
    expect(filed.seq).toBe(1);
    expect(filed.answer).toEqual({ type: "noul", noul: 0.9 });

    const edited = { ...body, question: { ...body.question, instructions: "Is it tiny?" } };
    await serveApiRequest(post({ ...edited, ...address }), { root, classifier });
    const tries = (await list()).tries;
    expect(tries.map((t) => t.seq)).toEqual([1, 2]);
    expect(tries[1]!.question.instructions).toBe("Is it tiny?");
  });

  test("a pair lists only its own tries, while the sequence stays run-wide", async () => {
    const classifier: Classifier = async () => ({ edited: { value: 0.4 } }) as never;
    await serveApiRequest(post({ ...body, rule: "is_small", input: "b.ts#e2" }), {
      root,
      classifier,
    });
    expect((await list("rule=is_small&input=b.ts%23e2")).tries.map((t) => t.seq)).toEqual([3]);
    expect((await list()).tries.map((t) => t.seq)).toEqual([1, 2]);
  });

  test("the call leaves no run of its own in the store", () => {
    expect(readdirSync(root)).toEqual(["run-a"]);
  });

  test("a try for a run that does not exist is a 404, and nothing is created", async () => {
    const res = await serveApiRequest(post({ ...body, ...address }, {}, "run-missing"), { root });
    expect(res?.status).toBe(404);
    expect(readdirSync(root)).toEqual(["run-a"]);
  });

  test("a foreign Origin is refused before any classifier call", async () => {
    const classifier: Classifier = async () => {
      throw new Error("must not be called");
    };
    const res = await serveApiRequest(
      post({ ...body, ...address }, { origin: "http://evil.example" }),
      { root, classifier },
    );
    expect(res?.status).toBe(403);
  });

  test("a non-JSON content type is refused", async () => {
    const req = new Request("http://localhost:1/api/runs/run-a/tries", {
      method: "POST",
      headers: { "content-type": "text/plain", host: "localhost:1" },
      body: JSON.stringify(body),
    });
    expect((await serveApiRequest(req, { root }))?.status).toBe(400);
  });

  test("a try without its pair address is refused", async () => {
    expect((await serveApiRequest(post(body), { root }))?.status).toBe(400);
  });

  test("a classifier failure is a 502 naming the failure, and files nothing", async () => {
    const before = (await list()).tries.length;
    const classifier: Classifier = async () => {
      throw new Error("endpoint down");
    };
    const res = await serveApiRequest(post({ ...body, ...address }), { root, classifier });
    expect(res?.status).toBe(502);
    expect(await res?.json()).toEqual({ error: "endpoint down" });
    expect((await list()).tries).toHaveLength(before);
  });
});

describe("parseClassifyRequest", () => {
  test("names the first missing field", () => {
    expect(parseClassifyRequest({})).toBe("state must be an object");
    expect(parseClassifyRequest({ state: { path: "a.ts" }, question: {} })).toBe(
      "state needs content (a file) or source (an element)",
    );
    expect(parseClassifyRequest({ state: body.state, question: { type: "noul" } })).toBe(
      "question.instructions must be a non-empty string",
    );
  });
});

describe("viewAnswer", () => {
  const q = (type: string, criteria: unknown) => ({ type, instructions: "?", criteria }) as never;
  test("noul reads as the card's noul field", () => {
    expect(viewAnswer(q("noul", {}), { value: 0.3 })).toEqual({ type: "noul", noul: 0.3 });
  });
  test("a refusal reads as a refusal", () => {
    expect(viewAnswer(q("noul", {}), { refused: true })).toEqual({ type: "refusal" });
  });
  test("score carries its legend and distribution", () => {
    expect(
      viewAnswer(q("score", ["bad", "good"]), {
        value: 0.7,
        probabilities: { "0": 0.3, "1": 0.7 },
      }),
    ).toEqual({
      type: "score",
      score: 0.7,
      legend: { "0": "bad", "1": "good" },
      probabilities: { "0": 0.3, "1": 0.7 },
    });
  });
  test("choice carries its selection and distribution", () => {
    expect(
      viewAnswer(q("choice", { a: "A", b: "B" }), {
        value: 0.8,
        choice: "a",
        probabilities: { a: 0.8, b: 0.2 },
        confidence: 0.9,
      }),
    ).toEqual({ type: "choice", choice: "a", probabilities: { a: 0.8, b: 0.2 }, confidence: 0.9 });
  });
});
