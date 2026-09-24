/**
 * Request debug tap for the jev adapter. Lives behind JEV_DEBUG_REQUEST=1 and captures the exact
 * bytes the vendor SDK serializes — not our pre-SDK question objects — so schema experiments can be
 * judged from real payloads.
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
export function requestDebug(config: ClassifierConfig | undefined): ClassifierConfig {
  if (process.env.JEV_DEBUG_REQUEST !== "1") return config ?? {};
  const runid = Date.now();
  const base = process.env.JEV_DEBUG_REQUEST_LOCATION || "/tmp/jint/requests";
  const dir = `${base}/${runid}`;
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
    } catch {
      // the tap never breaks the call it observes
    }
    return response;
  };
  return { ...config, fetch: logged };
}
