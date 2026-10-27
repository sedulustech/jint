/**
 * Run recording for the provider adapter: every run, on by default. Captures the exact bytes the
 * vendor SDK serializes — not our pre-SDK question objects — plus the manifest and the machine
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
 * request body, response status + body; a call through a provider's own client keeps exactly that,
 * a call through the vendor client keeps its System One request, a neutral response and the wire),
 * named <unixts>-<kind>-<file>.json, under the run dir <base>/<runId>/ (base = $JINT_RUNS_DIR, else
 * <homedir>/.jint/runs; runId = unix timestamp of the run's first request; past runs are never
 * overwritten). The kind (elements / files) is derived from the request's state shape.
 */
/** What this run recorded. Null before the recorder starts (never in a run that classifies). */
export interface RequestRecordSummary {
  dir: string;
  count: number;
  override: boolean;
}

/** Carries a state's id beside the request, never inside the state the model judges. */
export const ID_HEADER = "X-Jint-Id";

let runSummary: RequestRecordSummary | null = null;
let runStartedAt = 0;
let usageTotals = { input: 0, output: 0, cached: 0 };
/** The model the run asks, from the classifier config: readings differ between models. */
let runModel: string | undefined;
/** The provider name and url host the run asked (a host only: never a path, userinfo or key). */
let runRoute: { provider: string; host: string } | undefined;

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

/** The call that reached the network: url, body, status, response. Never a header or a key. */
export interface WireCall {
  url: string;
  body: unknown;
  status: number;
  response: unknown;
}

/** One recorded call's slot: the lowest fetch fills it, the recording fetch above reads it. */
const wireSlot = new AsyncLocalStorage<{ wire?: WireCall }>();

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The call a request belongs to, for a provider reached through its own client: the state's
 * run-scoped id and what names its file. Set around each ask, so the recording fetch beneath the
 * client knows whose exchange it sees without the id travelling to the provider.
 */
export interface CallContext {
  id: string;
  path: string;
  kind: "elements" | "files";
}

const callSlot = new AsyncLocalStorage<CallContext>();

/** Runs `body` as the call of `state`: the exchanges it makes are recorded as that call's. */
export function inCall<T>(
  state: { id: string; path: string; source?: string },
  body: () => Promise<T>,
): Promise<T> {
  const call: CallContext = {
    id: state.id,
    path: state.path,
    kind: state.source === undefined ? "files" : "elements",
  };
  return callSlot.run(call, body);
}

/**
 * Wrap the LOWEST fetch (beneath any protocol translation) so a recorded call also keeps the bytes
 * that went to the network. Reads only the url, the string body and the response; request headers
 * (the Authorization credential) are never touched. A no-op outside a recorded call.
 */
export function tapWire(base: Fetcher = (input, init) => fetch(input, init)): Fetcher {
  return async (input, init) => {
    const response = await base(input, init);
    const slot = wireSlot.getStore();
    if (slot !== undefined) {
      try {
        slot.wire = {
          url: redactUrl(input),
          body: asJson(typeof init?.body === "string" ? init.body : ""),
          status: response.status,
          response: asJson(await response.clone().text()),
        };
      } catch {
        // Wire capture never breaks the call it observes.
      }
    }
    return response;
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
      provider: runRoute?.provider,
      providerHost: runRoute?.host,
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

/**
 * Wrap the classifier's fetch so every call records. Calling this IS the start of a recorded run.
 * JINT_RUNS_DIR never changes WHETHER — only WHERE the run dir lands.
 */
export function recordRequests(
  config: ClassifierConfig | undefined,
  route?: { provider: string; host: string },
): ClassifierConfig {
  // The run id IS the run's start, and the run dir's name - one timestamp, one identity.
  const runId = Date.now();
  runStartedAt = runId;
  usageTotals = { input: 0, output: 0, cached: 0 };
  runModel = config?.model;
  runRoute = route;
  const base = runsBase();
  const dir = `${base}/${runId}`;
  runSummary = {
    dir,
    count: 0,
    override: process.env.JINT_RUNS_DIR !== undefined,
  };
  const baseFetch = config?.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const recordingFetch: (input: string, init?: RequestInit) => Promise<Response> = async (
    input,
    init,
  ) => {
    const startedAt = Date.now();
    const call = callSlot.getStore();
    const slot: { wire?: WireCall } = {};
    const response = await wireSlot.run(slot, () => baseFetch(input, init));
    try {
      const requestInit = init ?? {};
      const requestText = await new Request(input, requestInit).text();
      const responseText = await response.clone().text();
      // A call made through the provider's own client records the real exchange: the body sent and
      // the body received, nothing else. A call through the vendor client keeps its System One
      // request, the neutral response and the wire beneath them.
      const common = {
        ts: new Date().toISOString(),
        url: redactUrl(input),
        id: call?.id ?? new Headers(requestInit.headers).get(ID_HEADER) ?? undefined,
        durationMs: Date.now() - startedAt,
      };
      const body = asJson(
        requestInit.body !== undefined && typeof requestInit.body === "string"
          ? requestInit.body
          : requestText,
      );
      const record =
        call !== undefined
          ? { ...common, status: response.status, request: body, response: asJson(responseText) }
          : {
              ...common,
              request: body,
              status: response.status,
              response: asJson(responseText),
              wire: slot.wire,
            };
      const usage = (
        record.response as {
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cached_input_tokens?: number;
            input_tokens_details?: { cached_tokens?: number };
          };
        } | null
      )?.usage;
      if (usage) {
        usageTotals.input += usage.input_tokens ?? 0;
        usageTotals.output += usage.output_tokens ?? 0;
        usageTotals.cached +=
          usage.cached_input_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0;
      }
      mkdirSync(dir, { recursive: true });
      const state = (body as { state?: Record<string, unknown> } | null)?.state ?? {};
      const kind = call?.kind ?? ("source" in state ? "elements" : "files");
      const name = (call?.path ?? String(state.path ?? "state")).split("/").pop();
      const stamp = Date.now();
      let file = `${dir}/${stamp}-${kind}-${name}.json`;
      for (let i = 1; existsSync(file); i++) file = `${dir}/${stamp}-${kind}-${name}-${i}.json`;
      writeFileSync(file, JSON.stringify(record, null, 2));
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
