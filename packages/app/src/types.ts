import type { Element, HandlerData } from "@jint/contract";

export interface RunSummary {
  id: string;
  mtime: string;
  requests: number;
  /** Distinct rules the run measured (manifest handle snapshot). */
  ruleCount: number;
  /** Absolute config path from manifest.json; null = default rules, or unknown for legacy. */
  configPath: string | null;
  /** The run's source tree (manifest cwd), homedir collapsed to '~'. Absent when unknown. */
  cwd?: string;
  /** Migrated pre-store run: manifest marks it legacy; no cwd/config/report guaranteed. */
  legacy?: boolean;
  /** Wall duration of the run in ms (manifest durationMs); absent on pre-stats runs. */
  durationMs?: number;
  /** Token usage summed across the run's classifier responses; absent on pre-stats runs. */
  usage?: { input: number; output: number };
}

export interface RunDetail {
  id: string;
  requestCount: number;
  hasReport: boolean;
  results: RequestItem[];
  /** Per-rule handle snapshot from manifest.json; empty when manifest.json is absent. */
  handles: Record<string, HandlerData>;
  /**
   * Report.json was a fragment (torn write): canonical rules + severities fell back to per-request
   * answers.
   */
  reportDegraded: boolean;
  /** Migrated pre-store run: no report/handles/cwd guaranteed; severity falls back to null. */
  legacy?: boolean;
  /** Flat rule-target cells (one rule x one input). Empty when the report is degraded/absent. */
  cells: Cell[];
}

/** One rule measured against one input - the atom the grouped table navigates by. */
export interface Cell {
  rule: string;
  /** Bare path, never carries a #span. */
  file: string;
  /** Full measurement input: the file path, or path#uuid for an element. */
  input: string;
  /** The measured subject, from the report's Element projection. Absent = whole-unit (file). */
  element?: Element;
  /** The request file this cell's measurement came from; direct fetch on click. */
  requestFile?: string;
  /** The rule's own reading (p-space noul, or a score index for score handles). */
  value: number;
  /** Null = no verdict (never "clean"). */
  severity: "error" | "warn" | null;
}

export interface RequestItem {
  file: string;
  seq: number;
  ts: string;
  /** True when the request is a one-element call (state carries source); false = whole-unit. */
  element: boolean;
  path: string | null;
  elementId: string | null;
  rules: string[];
  questionCount: number;
  durationMs: number | null;
  maxProb: number | null;
  minProb: number | null;
  /** Every noul answer in the request, sorted. Drives histograms. */
  answers: number[];
  /** Provable verdict: finding join first, else handle-snapshot projection. Null = no verdict. */
  severity: "error" | "warn" | null;
  /** Per-rule verdicts at this input (span-aware join), keyed by canonical rule name. */
  severities: Record<string, "error" | "warn" | null>;
}

export interface RequestFile {
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

// jint report shapes come from the contract package - one definition, shared with the engine.
export type { ClassifyErrorInfo, Element, Finding, Measurement, Report } from "@jint/contract";
