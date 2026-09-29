import type { HandlerData } from "@jint/contract";

export interface RunSummary {
  id: string;
  mtime: string;
  requests: number;
  /** Absolute config path from manifest.json - REQUIRED; legacy runs are hidden by the handler. */
  configPath: string;
}

export interface RunDetail {
  id: string;
  requestCount: number;
  hasReport: boolean;
  requests: RequestSummary[];
  /** Per-rule handle snapshot from manifest.json; empty when absent (legacy run). */
  handles: Record<string, HandlerData>;
}

export interface RequestSummary {
  file: string;
  seq: number;
  ts: string;
  kind: "elements" | "files" | "unknown";
  path: string | null;
  elementId: string | null;
  rules: string[];
  questionCount: number;
  durationMs: number | null;
  maxProb: number | null;
  minProb: number | null;
  /** Every noul answer in the capture, sorted. Drives histograms and borderline sort. */
  answers: number[];
  /** Min |noul - 0.5| over the capture's answers: 0 == dead undecided. */
  borderline: number | null;
  /** Provable verdict: finding join first, else handle-snapshot projection. Null = no verdict. */
  severity: "error" | "warn" | null;
}

export interface Capture {
  ts?: string;
  url?: string;
  status?: number;
  request?: {
    state?: Record<string, unknown>;
    questions?: Record<
      string,
      { type?: string; instructions?: string; criteria?: { true?: string; false?: string } }
    >;
    model?: string;
  };
  response?: {
    model?: string;
    answers?: Record<string, { type?: string; noul?: number }>;
    usage?: Record<string, number>;
  };
}

// jint-report/v1 shapes come from the contract package - one definition, shared with the engine.
export type { ClassifyErrorInfo, Finding, Measurement, Report } from "@jint/contract";
