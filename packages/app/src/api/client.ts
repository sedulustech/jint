import type { Report, RunDetail, RunSummary } from "../types";
import type { QA } from "../views/AnswerCard";
import type { OriginalRead } from "@jint/sdk/ui/api";

const RUNS_URL = "/api/runs";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export const fetchRun = (id: string) => get<RunDetail>(`${RUNS_URL}/${id}`);
export const fetchRuns = () => get<{ runs: RunSummary[] }>(RUNS_URL);
/** The original classification of an address, as its run recorded it. */
export const fetchOriginal = (
  runId: string,
  address: { rule: string; input: string; file?: string },
) => {
  const query = new URLSearchParams({ rule: address.rule, input: address.input });
  if (address.file !== undefined) query.set("file", address.file);
  return get<OriginalRead>(`${RUNS_URL}/${runId}/original?${query}`);
};
export const fetchReport = (runId: string) =>
  get<Report | { absent: true }>(`${RUNS_URL}/${runId}/report`);

export interface ClassifyBody {
  state: { path?: string; content?: string; source?: string };
  question: { type: string; instructions: string; criteria?: unknown };
}

/** What an edit changes against the original; the server holds the original itself. */
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

/** The classifications filed for one address, oldest first. */
export const fetchClassifications = async (runId: string, rule: string, input: string) =>
  (
    await get<{ classifications: ClassificationRecord[] }>(
      `${classificationsUrl(runId)}?rule=${encodeURIComponent(rule)}&input=${encodeURIComponent(input)}`,
    )
  ).classifications;

/**
 * Classify an edit of one address; the server files it under the run as that address's next
 * classification.
 */
export async function postClassification(
  runId: string,
  address: { rule: string; input: string },
  edit: ClassificationEdit,
): Promise<ClassificationRecord> {
  const res = await fetch(classificationsUrl(runId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...edit, ...address }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    classification?: ClassificationRecord;
    error?: string;
  };
  if (!res.ok || payload.classification === undefined)
    throw new Error(payload.error ?? `${res.status}`);
  return payload.classification;
}
