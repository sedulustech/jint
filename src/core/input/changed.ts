/**
 * The changed-file LIST source (ctx.diff lens): stdin ("-") or an on-disk file, one path per line.
 * This is the caller's own pipeline — `git diff --name-only HEAD~1 | jint -` — jint never shells
 * out and never parses a VCS (pinned contract, guarded by test).
 *
 * The list is ONE flat list of paths: no added/modified/removed split (that is the caller's git
 * vocabulary, not ours — `git diff --name-status | cut -f2` if they ever want it). Entries are
 * relative to the input dir or absolute; the entry string is used VERBATIM as the file's identity,
 * so the lens anchor is the list itself (one anchor by construction).
 */

import { readFile, stat } from "node:fs/promises";
import { SetupError } from "../types.ts";

/** The list size ceiling, shared by both ingestion paths (stdin and file). */
export const MAX_LIST_BYTES = 16 * 1024 * 1024;

export async function readChangedSource(spec: string): Promise<string> {
  if (spec === "-") {
    const text = await Bun.stdin.text();
    if (text.length > MAX_LIST_BYTES) {
      throw new SetupError(
        "ENTRYPOINT_UNREADABLE",
        `changed list exceeds the ${MAX_LIST_BYTES} byte cap: ${text.length} bytes`,
      );
    }
    return text;
  }
  const info = await stat(spec).catch(() => null);
  if (info?.isFile()) {
    if (info.size > MAX_LIST_BYTES) {
      throw new SetupError(
        "ENTRYPOINT_UNREADABLE",
        `changed list exceeds the ${MAX_LIST_BYTES} byte cap: ${spec} is ${info.size} bytes`,
      );
    }
    return readFile(spec, "utf8");
  }
  throw new SetupError(
    "ENTRYPOINT_NOT_FOUND",
    `changed list not found: ${spec} (pass an on-disk list path, or pipe it: git diff --name-only HEAD~1 | jint -)`,
  );
}

/** The list, one path per line: trimmed, deduplicated (first occurrence wins), order kept. */
export function parseChangedList(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const path = raw.trim();
    if (path === "") continue;
    if (path.includes("\0")) {
      throw new SetupError(
        "ENTRYPOINT_UNREADABLE",
        `changed list entries must be line-separated paths; NUL-separated input (git -z) is not a list`,
      );
    }
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}
