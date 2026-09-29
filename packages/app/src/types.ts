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
  /** Report.json was a fragment (torn write): canonical rules + severities fell back to captures. */
  reportDegraded: boolean;
  /** Flat rule-target cells (one rule x one input). Empty when the report is degraded/absent. */
  cells: Cell[];
}

/** One rule measured against one input - the atom the grouped table navigates by. */
export interface Cell {
  rule: string;
  /** Bare path, never carries a #span. */
  file: string;
  /** Full measurement input: the file path, or path#span for an element. */
  input: string;
  kind: "file" | "element";
  /** The rule's own reading (p-space noul, or a score index for score handles). */
  value: number;
  /** Null = no verdict (never "clean"). */
  severity: "error" | "warn" | null;
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
  /** Every noul answer in the capture, sorted. Drives histograms. */
  answers: number[];
  /** Provable verdict: finding join first, else handle-snapshot projection. Null = no verdict. */
  severity: "error" | "warn" | null;
  /** Per-rule verdicts at this input (span-aware join), keyed by canonical rule name. */
  severities: Record<string, "error" | "warn" | null>;
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
    answers?: Record<
      string,
      {
        type?: string;
        noul?: number;
        score?: number;
        confidence?: number;
        legend?: Record<string, string>;
        probabilities?: Record<string, number>;
      }
    >;
    usage?: Record<string, number>;
  };
}

// jint-report/v1 shapes come from the contract package - one definition, shared with the engine.
export type { ClassifyErrorInfo, Finding, Measurement, Report } from "@jint/contract";
