/**
 * Run recording for the jev adapter: always on, every run. Captures the exact bytes the vendor SDK
 * serializes — not our pre-SDK question objects — plus the manifest and the machine report, so any
 * run can be replayed, inspected, or judged from real payloads. JEV_RECORD=0 is the only off switch
 * (harness and tools); JEV_DIR only moves WHERE the run dir lands.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import type { ClassifierConfig } from "./client.ts";

/**
 * Every raw HTTP request/response pair is written as its own pretty-printed JSON file (ts, url,
 * request body, response status + body), named <unixts>-<kind>-<file>.json, under the run dir
 * <base>/<runid>/ (base = JEV_DIR or <homedir>/.jint/runs; runid = unix timestamp of the run's
 * first request; past runs are never overwritten). The kind (elements / files) is derived from the
 * request's state shape. JEV_RECORD=0 disables recording entirely; any other value (including unset
 * and "1") records.
 */
/** What this run recorded, for the end-of-run stderr notice. Null when recording is disabled. */
export interface RequestRecordSummary {
  dir: string;
  count: number;
  override: boolean;
}

let runSummary: RequestRecordSummary | null = null;

/** This run's recording summary (null when recording is disabled). */
export function recordSummary(): RequestRecordSummary | null {
  return runSummary;
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
   * consumer can recompute severity exactly. TS-tier rules are absent (code policy, not data).
   */
  handles?: Record<string, unknown>;
}): void {
  if (runSummary === null) return;
  try {
    writeFileSync(`${runSummary.dir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  } catch {
    // recording never breaks the run it observes
  }
}

/**
 * Persist the run's machine report next to the requests: report.json, the EXACT bytes stdout --json
 * prints. Called by the CLI after rendering; a no-op when recording is disabled (never a second
 * write path, never a failure of the run it observes).
 */
export function recordRunReport(json: string): void {
  if (runSummary === null) return;
  try {
    mkdirSync(runSummary.dir, { recursive: true });
    writeFileSync(`${runSummary.dir}/report.json`, json);
  } catch {
    // recording never breaks the run it observes
  }
}

/**
 * Wrap the classifier's fetch so every call records. Recording is the default: the only off switch
 * is JEV_RECORD=0 (harness and tools); JEV_RECORD=1 is accepted as explicit-on. JEV_DIR never
 * changes WHETHER — only WHERE the run dir lands.
 */
export function recordRequests(config: ClassifierConfig | undefined): ClassifierConfig {
  if (process.env.JEV_RECORD === "0") {
    runSummary = null;
    return config ?? {};
  }
  const runid = Date.now();
  const base = process.env.JEV_DIR || `${homedir()}/.jint/runs`;
  const dir = `${base}/${runid}`;
  runSummary = { dir, count: 0, override: process.env.JEV_DIR !== undefined };
  const inner = config?.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const logged: (input: string, init?: RequestInit) => Promise<Response> = async (input, init) => {
    const response = await inner(input, init);
    try {
      const requestInit = init ?? {};
      const request = new Request(input, requestInit);
      const requestText = await request.text();
      const responseClone = response.clone();
      const responseText = await responseClone.text();
      const asJson = (text: string): unknown => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      };
      const record = {
        ts: new Date().toISOString(),
        url: input,
        request: asJson(
          requestInit.body !== undefined && typeof requestInit.body === "string"
            ? requestInit.body
            : requestText,
        ),
        status: response.status,
        response: asJson(responseText),
      };
      mkdirSync(dir, { recursive: true });
      const state = (record.request as { state?: Record<string, unknown> }).state ?? {};
      const kind = "source" in state ? "elements" : "files";
      const name = String(state.path ?? "state")
        .split("/")
        .pop();
      const stamp = Date.now();
      let file = `${dir}/${stamp}-${kind}-${name}.json`;
      for (let i = 1; existsSync(file); i++) file = `${dir}/${stamp}-${kind}-${name}-${i}.json`;
      writeFileSync(file, JSON.stringify(record, null, 2));
      runSummary!.count += 1;
    } catch {
      // recording never breaks the call it observes
    }
    return response;
  };
  return { ...config, fetch: logged };
}
