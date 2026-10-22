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
  /** Each rule's question kind (noul, score, choice), from its questions' wire type. */
  kinds?: Record<string, string>;
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
  /**
   * The rule's own reading: p-space noul, a score index for score handles, and for a choice rule
   * the probability its winning tier holds.
   */
  value: number;
  /** Null = no verdict (never "clean"). */
  severity: "error" | "warn" | null;
  /** The handle judged the reading and it needs no action. Absent when there is no handle. */
  pass?: true;
  /** A choice reading too close to call. */
  undecided?: true;
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

// The request-file wire shape is SDK-owned (the run-store API lives in @jint/sdk); one name, no drift.
export type { RequestFile } from "@jint/sdk/ui/api";

// jint report shapes come from the contract package - one definition, shared with the engine.
export type { ClassifyErrorInfo, Element, Report } from "@jint/contract";
