import type { Report, RunDetail, RunSummary } from "../types";
import type { QA } from "../views/AnswerCard";
import type { PairRead } from "@jint/sdk/ui/api";

const RUNS_URL = "/api/runs";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export const fetchRun = (id: string) => get<RunDetail>(`${RUNS_URL}/${id}`);
export const fetchRuns = () => get<{ runs: RunSummary[] }>(RUNS_URL);
/** One pair as its run recorded it; the server resolves which request read it. */
export const fetchPair = (runId: string, pair: { rule: string; input: string; file?: string }) => {
  const query = new URLSearchParams({ rule: pair.rule, input: pair.input });
  if (pair.file !== undefined) query.set("file", pair.file);
  return get<PairRead>(`${RUNS_URL}/${runId}/pair?${query}`);
};
export const fetchReport = (runId: string) =>
  get<Report | { absent: true }>(`${RUNS_URL}/${runId}/report`);

export interface ClassifyBody {
  state: { path?: string; content?: string; source?: string };
  question: { type: string; instructions: string; criteria?: unknown };
}

/** What an edit changes against the pair's original; the server holds the original itself. */
export interface ClassificationEdit {
  instructions?: string;
  criteria?: Record<string, string>;
  code?: string;
}

/** One filed classification: an edited question and state under its run, with the answer it earned. */
export interface ClassificationRecord extends ClassifyBody {
  seq: number;
  ts: string;
  rule: string;
  input: string;
  answer: NonNullable<QA["answer"]>;
  by?: "agent" | "user";
}

const classificationsUrl = (runId: string) => `${RUNS_URL}/${runId}/classifications`;

/** The classifications filed for one pair, oldest first. */
export const fetchClassifications = async (runId: string, rule: string, input: string) =>
  (
    await get<{ classifications: ClassificationRecord[] }>(
      `${classificationsUrl(runId)}?rule=${encodeURIComponent(rule)}&input=${encodeURIComponent(input)}`,
    )
  ).classifications;

/**
 * Classify an edit of one pair; the server files it under the run as the pair's next
 * classification.
 */
export async function postClassification(
  runId: string,
  pair: { rule: string; input: string },
  edit: ClassificationEdit,
): Promise<ClassificationRecord> {
  const res = await fetch(classificationsUrl(runId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...edit, ...pair }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    classification?: ClassificationRecord;
    error?: string;
  };
  if (!res.ok || payload.classification === undefined)
    throw new Error(payload.error ?? `${res.status}`);
  return payload.classification;
}
