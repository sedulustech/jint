import type { RequestFile, Report, RunDetail, RunSummary } from "../types";
import type { QA } from "../views/AnswerCard";

const RUNS_URL = "/api/runs";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export const fetchRun = (id: string) => get<RunDetail>(`${RUNS_URL}/${id}`);
export const fetchRuns = () => get<{ runs: RunSummary[] }>(RUNS_URL);
export const fetchRequestFile = (runId: string, file: string) =>
  get<RequestFile>(`${RUNS_URL}/${runId}/requests/${file}`);
export const fetchReport = (runId: string) =>
  get<Report | { absent: true }>(`${RUNS_URL}/${runId}/report`);

export interface ClassifyBody {
  state: { path?: string; content?: string; source?: string };
  question: { type: string; instructions: string; criteria?: unknown };
}

/** One filed try: an edited question and state under its run, with the answer it earned. */
export interface TryRecord extends ClassifyBody {
  seq: number;
  ts: string;
  rule: string;
  input: string;
  answer: NonNullable<QA["answer"]>;
  by?: "agent" | "manual";
}

const triesUrl = (runId: string) => `${RUNS_URL}/${runId}/tries`;

/** The tries filed for one pair, oldest first. */
export const fetchTries = async (runId: string, rule: string, input: string) =>
  (
    await get<{ tries: TryRecord[] }>(
      `${triesUrl(runId)}?rule=${encodeURIComponent(rule)}&input=${encodeURIComponent(input)}`,
    )
  ).tries;

/** Classify an edit of one pair; the server files it under the run as the pair's next try. */
export async function postTry(
  runId: string,
  pair: { rule: string; input: string },
  body: ClassifyBody,
): Promise<TryRecord> {
  const res = await fetch(triesUrl(runId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, ...pair }),
  });
  const payload = (await res.json().catch(() => ({}))) as { try?: TryRecord; error?: string };
  if (!res.ok || payload.try === undefined) throw new Error(payload.error ?? `${res.status}`);
  return payload.try;
}
