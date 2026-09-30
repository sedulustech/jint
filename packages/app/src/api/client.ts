import type { RequestFile, Report, RunDetail, RunSummary } from "../types";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export const fetchRun = (id: string) => get<RunDetail>(`/api/runs/${id}`);
export const fetchRuns = () =>
  get<{ runs: RunSummary[]; hiddenLegacy: number; legacyRuns: string[] }>(`/api/runs`);
export const fetchRequestFile = (runId: string, file: string) =>
  get<RequestFile>(`/api/runs/${runId}/requests/${file}`);
export const fetchReport = (runId: string) =>
  get<Report | { absent: true }>(`/api/runs/${runId}/report`);
