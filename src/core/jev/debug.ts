/**
 * Request debug tap for the jev adapter. Lives behind JEV_DEBUG_REQUEST=1 (or a
 * JEV_DEBUG_REQUEST_LOCATION override alone) and captures the exact bytes the vendor SDK serializes
 * — not our pre-SDK question objects — so schema experiments can be judged from real payloads.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { ClassifierConfig } from "./client.ts";

/**
 * When JEV_DEBUG_REQUEST=1, every raw HTTP request/response pair is written as its own
 * pretty-printed JSON file (ts, url, request body, response status + body), named
 * <unixts>-<kind>-<file>.json, under /tmp/jint/requests/<runid>/ (runid = unix timestamp of the
 * run's first capture; past runs are never overwritten). JEV_DEBUG_REQUEST_LOCATION overrides the
 * directory. The kind (elements / files) is derived from the request's state shape.
 */
/** What the tap observed this run, for the end-of-run stderr notice. Null when the tap is inactive. */
export interface RequestTapSummary {
  dir: string;
  count: number;
  override: boolean;
}

let tapSummary: RequestTapSummary | null = null;

/** The active tap's run summary (null when the tap never activated or wrote nothing counts as 0). */
/**
 * Persist the run's manifest next to the captures: which config ran, from where, with what argv.
 * Required for the run to appear as first-class in the measurement UI's picker (a run dir without a
 * manifest is legacy and is skipped with a count, never shown with a fake label).
 */
export function requestTapWriteManifest(manifest: {
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
  if (tapSummary === null) return;
  try {
    writeFileSync(`${tapSummary.dir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  } catch {
    // the tap never breaks the run it observes
  }
}

export function requestTapSummary(): RequestTapSummary | null {
  return tapSummary;
}

/**
 * Persist the run's machine report next to the captures: report.json, the EXACT bytes stdout --json
 * prints. Called by the CLI after rendering; a no-op when the tap is inactive (never a second write
 * path, never a failure of the run it observes).
 */
export function requestTapWriteReport(json: string): void {
  if (tapSummary === null) return;
  try {
    mkdirSync(tapSummary.dir, { recursive: true });
    writeFileSync(`${tapSummary.dir}/report.json`, json);
  } catch {
    // the tap never breaks the run it observes
  }
}

export function requestDebug(config: ClassifierConfig | undefined): ClassifierConfig {
  // Either variable activates: JEV_DEBUG_REQUEST=1 is the explicit on-switch; a
  // JEV_DEBUG_REQUEST_LOCATION override alone implies the run was launched to capture.
  const requested =
    process.env.JEV_DEBUG_REQUEST === "1" || process.env.JEV_DEBUG_REQUEST_LOCATION !== undefined;
  if (!requested) {
    tapSummary = null;
    return config ?? {};
  }
  const runid = Date.now();
  const base = process.env.JEV_DEBUG_REQUEST_LOCATION || "/tmp/jint/requests";
  const dir = `${base}/${runid}`;
  tapSummary = { dir, count: 0, override: process.env.JEV_DEBUG_REQUEST_LOCATION !== undefined };
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
      const capture = {
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
      const state = (capture.request as { state?: Record<string, unknown> }).state ?? {};
      const kind = "source" in state ? "elements" : "files";
      const name = String(state.path ?? "state")
        .split("/")
        .pop();
      const stamp = Date.now();
      let file = `${dir}/${stamp}-${kind}-${name}.json`;
      for (let i = 1; existsSync(file); i++) file = `${dir}/${stamp}-${kind}-${name}-${i}.json`;
      writeFileSync(file, JSON.stringify(capture, null, 2));
      tapSummary!.count += 1;
    } catch {
      // the tap never breaks the call it observes
    }
    return response;
  };
  return { ...config, fetch: logged };
}
