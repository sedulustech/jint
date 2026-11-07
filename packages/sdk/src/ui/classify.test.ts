import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decisionsParams, MODEL } from "../core/provider/decisions.ts";
import { classifiedState } from "../core/rules/classify.ts";
import { reclassify, serveApiRequest } from "./api.ts";
import { listClassifications, recordClassification } from "./classifications.ts";
import { applyEdit, classifyEdited, parseEdit, viewAnswer } from "./classify.ts";
import type { Classifier } from "../core/types.ts";

const body = {
  state: { path: "a.ts", source: "function f() {}" },
  question: {
    type: "noul",
    instructions: "Is it small?",
    criteria: { true: "Small.", false: "Big." },
  },
};

describe("a classification of an unedited recording", () => {
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
    // a classification asks them; the state the classifier is asked about is the one the run would build
    let asked: Parameters<Classifier>[0] | undefined;
    const classifier: Classifier = async (state, questions) => {
      asked = state;
      return Object.fromEntries(Object.keys(questions).map((name) => [name, { value: 0.5 }]));
    };
    const shown = {
      state: { source: "function f() {}", path: "a.ts" },
      question: body.question,
    } as never as Parameters<typeof classifyEdited>[0];
    await classifyEdited(shown, { classifier });
    const tried = wire(asked!, "edited", shown.question);
    expect(JSON.stringify(tried)).toBe(JSON.stringify(recorded));
  });
});

const root = mkdtempSync(join(tmpdir(), "jint-classifications-"));
// one recorded run: the element request that read "is_small at a.ts#e1"
mkdirSync(join(root, "run-a"));
writeFileSync(
  join(root, "run-a", "1700000000001-elements-a.ts.json"),
  JSON.stringify({
    ts: "2026-01-01T00:00:00.000Z",
    id: "e1",
    path: "a.ts",
    request: {
      state: { source: "function f() {}" },
      questions: { "is_small in e1": body.question },
    },
  }),
);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const post = (payload: unknown, headers: Record<string, string> = {}, run = "run-a") =>
  new Request(`http://localhost:1/api/runs/${run}/classifications`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:1", ...headers },
    body: JSON.stringify(payload),
  });
const address = { rule: "is_small", input: "a.ts#e1" };
const list = async (query = "rule=is_small&input=a.ts%23e1") =>
  (await (
    await serveApiRequest(
      new Request(`http://localhost:1/api/runs/run-a/classifications?${query}`),
      { root },
    )
  )?.json()) as {
    classifications: { seq: number; answer: unknown; question: { instructions: string } }[];
  };

describe("classifications under a run", () => {
  test("a classification asks about the edit, files it under the run, and lists back oldest first", async () => {
    const asked: unknown[] = [];
    const classifier: Classifier = async (_state, questions) => {
      asked.push(questions.edited);
      return { edited: { value: 0.9 } } as never;
    };
    const first = await serveApiRequest(post({ ...address }), { root, classifier });
    expect(first?.status).toBe(200);
    const filed = (
      (await first?.json()) as { classification: { seq: number; answer: unknown; by: string } }
    ).classification;
    expect(filed.seq).toBe(1);
    expect(filed.by).toBe("user");
    expect(filed.answer).toEqual({ type: "noul", noul: 0.9 });
    // no edit: the original question went out as recorded
    expect(asked[0]).toEqual(body.question);

    await serveApiRequest(post({ ...address, instructions: "Is it tiny?" }), { root, classifier });
    const classifications = (await list()).classifications;
    expect(classifications.map((t) => t.seq)).toEqual([1, 2]);
    expect(classifications[1]!.question.instructions).toBe("Is it tiny?");
  });

  test("an edit lays over the original: one criterion and the code change, the rest stays", async () => {
    let asked: { state: Parameters<Classifier>[0]; question: unknown } | undefined;
    const classifier: Classifier = async (state, questions) => {
      asked = { state, question: questions.edited };
      return { edited: { value: 0.2 } } as never;
    };
    await serveApiRequest(
      post({ ...address, criteria: { false: "Huge." }, code: "function g() {}" }),
      { root, classifier },
    );
    expect(asked!.question).toEqual({
      ...body.question,
      criteria: { true: "Small.", false: "Huge." },
    });
    expect(JSON.stringify(asked!.state)).toContain("function g() {}");
  });

  test("an address lists only its own classifications, while the sequence stays run-wide", async () => {
    const classifier: Classifier = async () => ({ edited: { value: 0.4 } }) as never;
    const before = (await list()).classifications.length;
    // the same recorded element, filed under another address
    await reclassify(
      "run-a",
      { rule: "is_small", input: "a.ts#e1" },
      {},
      {
        root,
        classifier,
        by: "agent",
      },
    );
    expect((await list()).classifications).toHaveLength(before + 1);
    expect((await list("rule=other&input=a.ts%23e1")).classifications).toEqual([]);
  });

  test("reclassify records its actor, so the agent and the user share one path", async () => {
    const classifier: Classifier = async () => ({ edited: { value: 0.6 } }) as never;
    const filed = await reclassify(
      "run-a",
      address,
      { instructions: "Is it short?" },
      {
        root,
        classifier,
        by: "agent",
      },
    );
    expect(filed.by).toBe("agent");
    expect(filed.question.instructions).toBe("Is it short?");
    expect(filed.rule).toBe("is_small");
  });

  test("the call leaves no run of its own in the store", () => {
    expect(readdirSync(root)).toEqual(["run-a"]);
  });

  test("an address the run never recorded is a 404", async () => {
    const res = await serveApiRequest(post({ rule: "is_small", input: "nope.ts#e9" }), { root });
    expect(res?.status).toBe(404);
  });

  test("an edit naming a criterion the question lacks is a 400 naming it", async () => {
    const res = await serveApiRequest(post({ ...address, criteria: { maybe: "?" } }), { root });
    expect(res?.status).toBe(400);
    expect(JSON.stringify(await res?.json())).toContain("maybe");
  });

  test("a classification for a run that does not exist is a 404, and nothing is created", async () => {
    const res = await serveApiRequest(post({ ...address }, {}, "run-missing"), { root });
    expect(res?.status).toBe(404);
    expect(readdirSync(root)).toEqual(["run-a"]);
  });

  test("a foreign Origin is refused before any classifier call", async () => {
    const classifier: Classifier = async () => {
      throw new Error("must not be called");
    };
    const res = await serveApiRequest(post({ ...address }, { origin: "http://evil.example" }), {
      root,
      classifier,
    });
    expect(res?.status).toBe(403);
  });

  test("a non-JSON content type is refused", async () => {
    const req = new Request("http://localhost:1/api/runs/run-a/classifications", {
      method: "POST",
      headers: { "content-type": "text/plain", host: "localhost:1" },
      body: JSON.stringify(address),
    });
    expect((await serveApiRequest(req, { root }))?.status).toBe(400);
  });

  test("a classification without its address is refused", async () => {
    expect((await serveApiRequest(post({ instructions: "x" }), { root }))?.status).toBe(400);
  });

  test("a classifier failure is a 502 naming the failure, and files nothing", async () => {
    const before = (await list()).classifications.length;
    const classifier: Classifier = async () => {
      throw new Error("endpoint down");
    };
    const res = await serveApiRequest(post({ ...address }), { root, classifier });
    expect(res?.status).toBe(502);
    expect(await res?.json()).toEqual({ error: "endpoint down" });
    expect((await list()).classifications).toHaveLength(before);
  });
});

describe("the original lookup", () => {
  const get = (query: string) =>
    serveApiRequest(new Request(`http://localhost:1/api/runs/run-a/original?${query}`), { root });
  test("returns the request that read the address with its own question and answer", async () => {
    const res = await get("rule=is_small&input=a.ts%23e1");
    expect(res?.status).toBe(200);
    const read = (await res?.json()) as {
      result: { file: string; path: string };
      request: { request: { state: { source: string } } };
      classification: { key: string; question: { instructions: string } };
    };
    expect(read.result).toMatchObject({ file: "1700000000001-elements-a.ts.json", path: "a.ts" });
    expect(read.request.request.state.source).toBe("function f() {}");
    expect(read.classification).toMatchObject({ key: "is_small in e1", question: body.question });
  });
  test("an explicit file wins; an address the run never recorded is a 404; the address is required", async () => {
    const named = await get("rule=is_small&input=other.ts&file=1700000000001-elements-a.ts.json");
    expect(named?.status).toBe(200);
    expect((await get("rule=is_small&input=nope.ts%23e9"))?.status).toBe(404);
    expect((await get("rule=is_small"))?.status).toBe(400);
  });
  test("a rule the request never asked reads as no classification, not an error", async () => {
    const read = (await (await get("rule=other_rule&input=a.ts%23e1"))?.json()) as {
      classification: unknown;
    };
    expect(read.classification).toBeNull();
  });
});

describe("filing", () => {
  test("actors filing at the same moment each get their own number, none overwritten", async () => {
    const runDir = join(root, "run-a");
    const entry = (input: string) => ({
      rule: "is_small",
      input,
      state: { source: "x" },
      question: { type: "noul", instructions: "?" } as never,
      answer: { type: "noul", noul: 0.5 },
    });
    const filed = await Promise.all(
      Array.from({ length: 8 }, () => recordClassification(runDir, entry("race.ts#e1"))),
    );
    expect(new Set(filed.map((f) => f.seq)).size).toBe(8);
    expect(filed.map((f) => f.n).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await listClassifications(runDir, "is_small", "race.ts#e1")).map((f) => f.n)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });
});

describe("parseEdit and applyEdit", () => {
  test("parseEdit names what is wrong, and keeps only the edit's own fields", () => {
    expect(parseEdit(null)).toBe("body must be a JSON object");
    expect(parseEdit({ instructions: " " })).toBe(
      "instructions must be a non-empty string when present",
    );
    expect(parseEdit({ code: 3 })).toBe("code must be a string when present");
    expect(parseEdit({ criteria: { a: 1 } })).toBe("every criteria text must be a string");
    expect(parseEdit({ code: "x", extra: 1 })).toEqual({ code: "x" });
  });
  test("applyEdit sets a score level by its index", () => {
    const original = {
      state: { content: "x" },
      question: { type: "score", instructions: "?", criteria: ["low", "high"] },
    } as never as Parameters<typeof applyEdit>[0];
    expect(applyEdit(original, { criteria: { "1": "very high" } })).toEqual({
      state: { content: "x" },
      question: { type: "score", instructions: "?", criteria: ["low", "very high"] },
    });
    expect(applyEdit(original, { criteria: { "2": "?" } })).toContain("no such criteria: 2");
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
