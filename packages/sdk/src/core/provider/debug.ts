/**
 * Run recording for the provider adapter: every run, on by default. Captures the exact bytes the
 * provider's client sends — not our pre-client question objects — plus the manifest and the machine
 * report, so any run can be replayed, inspected, or judged from real payloads. Only the in-process
 * test seam stops it; JINT_RUNS_DIR moves WHERE the run dir lands, never WHETHER one is written.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ClassifierConfig } from "./client.ts";

/**
 * Every raw HTTP request/response pair is written as its own pretty-printed JSON file (ts, url,
 * request body, response status + body: the real exchange, nothing else), named
 * <unixts>-<kind>-<file>.json, under the run dir <base>/<runId>/ (base = $JINT_RUNS_DIR, else
 * <homedir>/.jint/runs; runId = unix timestamp of the run's first request; past runs are never
 * overwritten). The kind (elements / files) is derived from the request's state shape.
 */
/** What this run recorded. Null before the recorder starts (never in a run that classifies). */
export interface RequestRecordSummary {
  dir: string;
  count: number;
  /** Answers served from the answer cache instead of a call (each also leaves a record file). */
  cached: number;
  override: boolean;
}

let runSummary: RequestRecordSummary | null = null;
let runStartedAt = 0;
let usageTotals = { input: 0, output: 0, cached: 0 };
/** The model the run sent (the reply's own once one arrives): readings differ between models. */
let runModel: string | undefined;
/** The url host the run asked (a host only: never a path, userinfo or key). */
let runHost: string | undefined;

/** A url without userinfo or query: a recorded request must never carry a credential. */
function redactUrl(input: string): string {
  try {
    const url = new URL(input);
    url.username = "";
    url.password = "";
    url.search = "";
    return url.toString();
  } catch {
    return input;
  }
}

/**
 * Parsed when it parses, else verbatim: a non-JSON payload (a proxy's HTML error page, say) is
 * evidence.
 */
function asJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The call a request belongs to: the state's run-scoped id and what names its file. Set around each
 * ask, so the recording fetch beneath the client knows whose exchange it sees without the id
 * travelling to the provider.
 */
export interface CallContext {
  id: string;
  /**
   * The question ids in the order the request names them (q0, q1, ...): the request holds only
   * positions.
   */
  questionIds: string[];
  path: string;
  kind: "elements" | "files";
}

const callSlot = new AsyncLocalStorage<CallContext>();

/** Runs `body` as the call of `state`: the exchanges it makes are recorded as that call's. */
export function inCall<T>(
  state: { id: string; path: string; source?: string },
  questionIds: string[],
  body: () => Promise<T>,
): Promise<T> {
  const call: CallContext = {
    id: state.id,
    questionIds,
    path: state.path,
    kind: state.source === undefined ? "files" : "elements",
  };
  return callSlot.run(call, body);
}

/**
 * Runs `body` as a call that carries only the questions `ids`, in that order: when part of a
 * state's questions come from the answer cache, the request holds the rest, and its record must
 * name those positions.
 */
export function inQuestions<T>(ids: string[], body: () => Promise<T>): Promise<T> {
  const call = callSlot.getStore();
  return call === undefined ? body() : callSlot.run({ ...call, questionIds: ids }, body);
}

/**
 * The tokens a recorded reply reports: the Decisions API's usage (input_tokens,
 * input_tokens_details).
 */
function tokensOf(response: unknown): { input: number; output: number; cached: number } {
  const reply = (typeof response === "object" && response !== null ? response : {}) as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    };
  };
  const usage = reply.usage;
  return {
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
    cached: usage?.input_tokens_details?.cached_tokens ?? 0,
  };
}

/** One line from a thrown value of unknown shape (a non-Error carries only its own text). */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** This run's recording summary; null before the recorder starts. */
export function recordSummary(): RequestRecordSummary | null {
  return runSummary;
}

/**
 * The run-store base directory: $JINT_RUNS_DIR, else <homedir>/.jint/runs — ONE var, one root, no
 * precedence chain. The same resolution the recorder applies, exported so the UI server serves the
 * SAME store the recorder writes (no second homedir constant in the SDK).
 *
 * Deliberation note (recorded, not implemented): if a container one-knob need ever materializes,
 * the future shape is a JINT_HOME base the specific vars DEFAULT FROM (JINT_GRAMMAR_DIR,
 * JINT_RUNS_DIR; specific always wins) — never an umbrella tier.
 */
export function runsBase(): string {
  return process.env.JINT_RUNS_DIR !== undefined
    ? resolve(process.env.JINT_RUNS_DIR)
    : `${homedir()}/.jint/runs`;
}

/**
 * Persist the run's manifest next to the requests: which config ran, from where, with what argv.
 * Written for every recorded run, so the measurement UI's picker can show every new run as
 * first-class (pre-migration runs without a manifest carry a legacy flag and only a timestamp — the
 * store handled that; new runs always have one).
 */
export function recordRunManifest(manifest: {
  configPath: string | null;
  cwd: string;
  argv: readonly string[];
  ts: string;
  /**
   * Per-rule declarative handle snapshot (rule -> NoulHandlerData | ScoreHandlerData), so any
   * consumer can recompute severity exactly. custom-tier rules are absent (code policy, not data).
   */
  handles?: Record<string, unknown>;
  /** Wall duration of the run in ms, from recorder start to manifest write. */
  durationMs?: number;
  /** Token usage summed across the run's classifier responses. */
  usage?: { input: number; output: number; cached: number };
}): void {
  if (runSummary === null) return;
  try {
    const withRunStats = {
      ...manifest,
      durationMs: Date.now() - runStartedAt,
      model: runModel,
      providerHost: runHost,
      usage: { ...usageTotals },
    };
    writeFileSync(`${runSummary.dir}/manifest.json`, JSON.stringify(withRunStats, null, 2) + "\n");
  } catch (err) {
    // Recording never breaks the run it observes: the dropped manifest IS the warning.
    process.emitWarning(
      `jint: could not record the run manifest in ${runSummary.dir}: ${errorMessage(err)}`,
    );
  }
}

/**
 * Persist the run's machine report next to the requests: report.json, the EXACT bytes stdout --json
 * prints. Called by the CLI after rendering; a no-op before the recorder has started (never a
 * second write path, never a failure of the run it observes).
 */
export function recordRunReport(json: string): void {
  if (runSummary === null) return;
  try {
    mkdirSync(runSummary.dir, { recursive: true });
    writeFileSync(`${runSummary.dir}/report.json`, json);
  } catch (err) {
    process.emitWarning(
      `jint: could not record the run report in ${runSummary.dir}: ${errorMessage(err)}`,
    );
  }
}

/** One exchange as its own file in the run dir, named by kind and the file it concerns. */
function writeRecordFile(
  dir: string,
  call: CallContext | undefined,
  state: Record<string, unknown>,
  record: unknown,
): void {
  mkdirSync(dir, { recursive: true });
  const kind = call?.kind ?? ("source" in state ? "elements" : "files");
  const name = (call?.path ?? String(state.path ?? "state")).split("/").pop();
  const stamp = Date.now();
  let file = `${dir}/${stamp}-${kind}-${name}.json`;
  for (let i = 1; existsSync(file); i++) file = `${dir}/${stamp}-${kind}-${name}-${i}.json`;
  writeFileSync(file, JSON.stringify(record, null, 2));
}

/**
 * Records the answers a call took from the answer cache as an exchange of their own: the request
 * they stand for and the reply as stored, with no usage (nothing was sent). The run view reads it
 * like any other request file; `cached: true` marks it.
 */
export function recordCacheHit(
  url: string,
  ids: string[],
  exchange: { request: unknown; response: unknown },
): void {
  if (runSummary === null) return;
  const stored = callSlot.getStore();
  const call = stored === undefined ? undefined : { ...stored, questionIds: ids };
  try {
    const record = {
      ts: new Date().toISOString(),
      url: redactUrl(url),
      id: call?.id,
      durationMs: 0,
      questionIds: call?.questionIds,
      status: 200,
      cached: true,
      request: exchange.request,
      response: exchange.response,
    };
    writeRecordFile(runSummary.dir, call, {}, record);
    runSummary.cached += (exchange.response as { answers: unknown[] }).answers.length;
  } catch (err) {
    process.emitWarning(
      `jint: could not record a cached answer in ${runSummary.dir}: ${errorMessage(err)}`,
    );
  }
}

/**
 * Wrap the classifier's fetch so every call records. Calling this IS the start of a recorded run.
 * JINT_RUNS_DIR never changes WHETHER — only WHERE the run dir lands.
 */
export function recordRequests(
  config: ClassifierConfig | undefined,
  route?: { model: string; host: string },
): ClassifierConfig {
  // The run id IS the run's start, and the run dir's name - one timestamp, one identity.
  const runId = Date.now();
  runStartedAt = runId;
  usageTotals = { input: 0, output: 0, cached: 0 };
  runModel = route?.model;
  runHost = route?.host;
  const base = runsBase();
  const dir = `${base}/${runId}`;
  runSummary = {
    dir,
    count: 0,
    cached: 0,
    override: process.env.JINT_RUNS_DIR !== undefined,
  };
  const baseFetch = config?.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const recordingFetch: (input: string, init?: RequestInit) => Promise<Response> = async (
    input,
    init,
  ) => {
    const startedAt = Date.now();
    const call = callSlot.getStore();
    const response = await baseFetch(input, init);
    try {
      const requestInit = init ?? {};
      const requestText = await new Request(input, requestInit).text();
      const responseText = await response.clone().text();
      // The real exchange: the body sent and the body received, nothing else.
      const common = {
        ts: new Date().toISOString(),
        url: redactUrl(input),
        id: call?.id,
        durationMs: Date.now() - startedAt,
      };
      const body = asJson(
        requestInit.body !== undefined && typeof requestInit.body === "string"
          ? requestInit.body
          : requestText,
      );
      const record = {
        ...common,
        questionIds: call?.questionIds,
        status: response.status,
        request: body,
        response: asJson(responseText),
      };
      const replied = (record.response as { model?: unknown } | null)?.model;
      if (typeof replied === "string") runModel = replied;
      const counted = tokensOf(record.response);
      usageTotals.input += counted.input;
      usageTotals.output += counted.output;
      usageTotals.cached += counted.cached;
      const state = (body as { state?: Record<string, unknown> } | null)?.state ?? {};
      writeRecordFile(dir, call, state, record);
      runSummary!.count += 1;
    } catch (err) {
      // Recording never breaks the call it observes: the call's own bytes are still stored
      // verbatim, so a failed write costs only the pretty-printed copy.
      process.emitWarning(`jint: could not record a request in ${dir}: ${errorMessage(err)}`);
    }
    return response;
  };
  return { ...config, fetch: recordingFetch };
}
