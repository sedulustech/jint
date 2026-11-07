import { createClassifier } from "../core/provider/client.ts";
import { classifiedState } from "../core/rules/classify.ts";
import type { Classifier, QuestionSchema } from "../core/types.ts";
/**
 * The classification route: classify ONE edited question against ONE edited state and answer, so a
 * reader can reword criteria or change the code in the run UI and see the reading move. Nothing is
 * recorded to the run store and nothing is written to the config: the edit lives in the request.
 */
import type { ClassifiedAnswer, Refusal } from "@jint/contract";

/** The one question name an edited pair is asked under. */
const QUESTION_NAME = "edited";

export interface ClassifyRequest {
  /**
   * The judged state as the model saw it: a file (content) or an element (source), with a path only
   * when the rule's request carried one.
   */
  state: { path?: string; content?: string; source?: string };
  question: QuestionSchema;
}

export interface ClassifyOptions {
  /** The classifier to ask; default the environment-keyed Decisions client. */
  classifier?: Classifier;
}

/**
 * The exchange of one classification, as it went over the wire (absent when the classifier was
 * injected).
 */
export interface Wire {
  request: unknown;
  response: unknown;
}

/** The request body as a ClassifyRequest, or the reason it is not one. */
export function parseClassifyRequest(body: unknown): ClassifyRequest | string {
  if (typeof body !== "object" || body === null) return "body must be a JSON object";
  const { state, question } = body as Partial<ClassifyRequest>;
  if (typeof state !== "object" || state === null) return "state must be an object";
  if (state.path !== undefined && typeof state.path !== "string")
    return "state.path must be a string when present";
  if (typeof state.content !== "string" && typeof state.source !== "string")
    return "state needs content (a file) or source (an element)";
  if (typeof question !== "object" || question === null) return "question must be an object";
  if (!["noul", "score", "choice"].includes(question.type))
    return "question.type must be noul, score or choice";
  if (typeof question.instructions !== "string" || question.instructions.trim() === "")
    return "question.instructions must be a non-empty string";
  return { state, question };
}

/**
 * The run view's answer shape for a classifier answer - the shape a recorded reading has, so the
 * same card renders a recorded answer and an edited one.
 */
export function viewAnswer(question: QuestionSchema, answer: ClassifiedAnswer | Refusal): unknown {
  if ("refused" in answer) return { type: "refusal" };
  const confidence = answer.confidence !== undefined ? { confidence: answer.confidence } : {};
  if (question.type === "noul") return { type: "noul", noul: answer.value };
  if (question.type === "score") {
    // the legend carries each level's text; the card shows the levels from it
    const legend = Object.fromEntries(
      (question.criteria as readonly string[]).map((text, level) => [String(level), text]),
    );
    return {
      type: "score",
      score: answer.value,
      legend,
      probabilities: answer.probabilities,
      ...confidence,
    };
  }
  return {
    type: "choice",
    choice: answer.choice,
    probabilities: answer.probabilities,
    ...confidence,
  };
}

/**
 * Ask the classifier the one edited question: the answer in the run view's shape and, with the
 * default classifier, the exchange that produced it. Nothing is recorded here - the caller files
 * the classification under the run it edits.
 */
export async function classifyEdited(
  request: ClassifyRequest,
  options: ClassifyOptions = {},
): Promise<{ answer: unknown; wire?: Wire }> {
  let wire: Wire | undefined;
  const classifier =
    options.classifier ??
    createClassifier({
      record: false,
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        wire = {
          request: parseJson(String(init?.body ?? "")),
          response: parseJson(await response.clone().text()),
        };
        return response;
      },
    });
  // A state that carries a path is asked with it (the rule includes it); one without is asked
  // without, so the classification is the request the reading was.
  const { path, content, source } = request.state;
  const includePath = path !== undefined;
  const state =
    content !== undefined
      ? classifiedState({ path: path ?? "", content }, includePath)
      : classifiedState({ path: path ?? "", source: source ?? "", id: "edited" }, includePath);
  const answers = await classifier(state, { [QUESTION_NAME]: request.question });
  const answer = answers[QUESTION_NAME];
  return {
    answer: answer === undefined ? { type: "refusal" } : viewAnswer(request.question, answer),
    wire,
  };
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
