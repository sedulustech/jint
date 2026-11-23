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
import { newRunId } from "./run-id.ts";
import type { ClassifierConfig } from "./client.ts";

/**
 * Every raw HTTP request/response pair is written as its own pretty-printed JSON file (ts, url,
 * request body, response status + body), named <unixts>-<kind>-<file>.json, under the run dir
 * <base>/<runId>/ (base = $JINT_RUNS_DIR, else <homedir>/.jint/runs; runId = unix timestamp of the
 * run's start, bumped to the next free millisecond when another run took it; past runs are never
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
let runModel: string | undefined;
/** The url host the run asked (a host only: never a path, userinfo or key). */
let runHost: string | undefined;

/**
 * Claims the run's own directory, named by a new run id. mkdir without `recursive` fails with
 * EEXIST atomically, so a run never writes into another's dir: on the rare clash it draws a new id.
 * An unwritable store is not claimable: it warns with the cause and the dir is returned as named,
 * so recording never breaks the run it observes.
 */
function claimRunDir(base: string, start: number): string {
  try {
    mkdirSync(base, { recursive: true });
    for (;;) {
      const dir = `${base}/${newRunId(start)}`;
      try {
        mkdirSync(dir);
        return dir;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
  } catch (err) {
    process.emitWarning(new Error(`jint: cannot claim a run dir in ${base}`, { cause: err }));
    return `${base}/${newRunId(start)}`;
  }
}

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

export interface CallContext {
  id: string;
  questionIds: string[];
  path: string;
  kind: "elements" | "files";
}

const callSlot = new AsyncLocalStorage<CallContext>();

/**
 * Runs `body` as the call of `state`: the exchanges it makes are recorded as that call's. A call
 * that is already running keeps its address: a custom rule composes its own state, so only the
 * element it judges can say where the answer belongs.
 */
export function inCall<T>(
  state: { id: string; path: string; source?: string },
  questionIds: string[],
  body: () => Promise<T>,
): Promise<T> {
  const address = callSlot.getStore() ?? {
    id: state.id,
    path: state.path,
    kind: state.source === undefined ? ("files" as const) : ("elements" as const),
  };
  const call: CallContext = { ...address, questionIds };
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

/** What the run cost so far: the model that answered, the wall time, and the tokens used. */
export interface RunStats {
  readonly model?: string;
  readonly durationMs: number;
  readonly usage: { readonly input: number; readonly output: number; readonly cached: number };
}

/**
 * The run's model, duration and token usage, from the recorder's own counters. The manifest and the
 * report both read it here, so the two never disagree about what the run used.
 */
export function runStats(): RunStats {
  return { model: runModel, durationMs: Date.now() - runStartedAt, usage: { ...usageTotals } };
}

/**
 * Persist the run's manifest next to the requests: which config ran, from where, with what argv.
 * Written for every recorded run, so the run UI's picker can show every new run as first-class
 * (pre-migration runs without a manifest carry a legacy flag and only a timestamp — the store
 * handled that; new runs always have one).
 */
export function recordRunManifest(manifest: {
  configPath: string | null;
  cwd: string;
  argv: readonly string[];
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
    const stamps = {
      createdAt: new Date(runStartedAt).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const withRunStats = { ...stamps, ...manifest, ...runStats(), providerHost: runHost };
    writeFileSync(`${runSummary.dir}/manifest.json`, JSON.stringify(withRunStats, null, 2) + "\n");
  } catch (err) {
    // Recording never breaks the run it observes: the dropped manifest IS the warning.
    process.emitWarning(
      new Error(`jint: could not record the run manifest in ${runSummary.dir}`, { cause: err }),
    );
  }
}

export function recordRunReport(json: string): void {
  if (runSummary === null) return;
  try {
    mkdirSync(runSummary.dir, { recursive: true });
    writeFileSync(`${runSummary.dir}/report.json`, json);
  } catch (err) {
    process.emitWarning(
      new Error(`jint: could not record the run report in ${runSummary.dir}`, { cause: err }),
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
      path: call?.path,
      kind: call?.kind,
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
      new Error(`jint: could not record a cached answer in ${runSummary.dir}`, { cause: err }),
    );
  }
}

interface Exchange {
  input: string;
  init?: RequestInit;
  response: Response;
  startedAt: number;
}

async function recordExchange(dir: string, exchange: Exchange): Promise<void> {
  const { input, init, response, startedAt } = exchange;
  const call = callSlot.getStore();
  const requestText = await new Request(input, init ?? {}).text();
  const responseText = await response.clone().text();
  const body = asJson(typeof init?.body === "string" ? init.body : requestText);
  const record = {
    ts: new Date().toISOString(),
    url: redactUrl(input),
    id: call?.id,
    path: call?.path,
    kind: call?.kind,
    durationMs: Date.now() - startedAt,
    questionIds: call?.questionIds,
    status: response.status,
    request: body,
    response: asJson(responseText),
  };
  countReply(record.response);
  const state = (body as { state?: Record<string, unknown> } | null)?.state ?? {};
  writeRecordFile(dir, call, state, record);
  runSummary!.count += 1;
}

function countReply(reply: unknown): void {
  const replied = (reply as { model?: unknown } | null)?.model;
  if (typeof replied === "string") runModel = replied;
  const counted = tokensOf(reply);
  usageTotals.input += counted.input;
  usageTotals.output += counted.output;
  usageTotals.cached += counted.cached;
}

/**
 * Wrap the classifier's fetch so every call records. Calling this IS the start of a recorded run.
 * JINT_RUNS_DIR never changes WHETHER — only WHERE the run dir lands.
 */
export function recordRequests(
  config: ClassifierConfig | undefined,
  route?: { model: string; host: string },
): ClassifierConfig {
  runStartedAt = Date.now();
  usageTotals = { input: 0, output: 0, cached: 0 };
  runModel = route?.model;
  runHost = route?.host;
  const dir = claimRunDir(runsBase(), runStartedAt);
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
    const response = await baseFetch(input, init);
    // Recording never breaks the call it observes.
    await recordExchange(dir, { input, init, response, startedAt }).catch((cause: unknown) => {
      process.emitWarning(new Error(`jint: could not record a request in ${dir}`, { cause }));
    });
    return response;
  };
  return { ...config, fetch: recordingFetch };
}
