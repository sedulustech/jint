/**
 * The path-list source (the CLI's `paths` noun): stdin ("-") or an on-disk file, one path per line.
 * This is the caller's own pipeline — `git diff --name-only HEAD~1 | jint paths -` — jint never
 * shells out and never parses a VCS (pinned contract, guarded by test).
 *
 * The list is ONE flat list of paths: no added/modified/removed split (that is the caller's git
 * vocabulary, not ours — `git diff --name-status | cut -f2` if they ever want it). Entries are
 * relative to the input dir or absolute; the entry string is used VERBATIM as the file's identity.
 */

import { readFile, stat } from "node:fs/promises";
import { SetupError } from "../types.ts";

/** The list size ceiling, shared by both ingestion paths (stdin and file). */
export const MAX_LIST_BYTES = 16 * 1024 * 1024;

export async function readPathsSource(spec: string): Promise<string> {
  if (spec === "-") {
    const text = await Bun.stdin.text();
    if (text.length > MAX_LIST_BYTES) {
      throw new SetupError(
        "ENTRYPOINT_UNREADABLE",
        `path list exceeds the ${MAX_LIST_BYTES} byte cap: ${text.length} bytes`,
      );
    }
    return text;
  }
  const info = await stat(spec).catch(() => null);
  if (info?.isFile()) {
    if (info.size > MAX_LIST_BYTES) {
      throw new SetupError(
        "ENTRYPOINT_UNREADABLE",
        `path list exceeds the ${MAX_LIST_BYTES} byte cap: ${spec} is ${info.size} bytes`,
      );
    }
    return readFile(spec, "utf8");
  }
  throw new SetupError(
    "ENTRYPOINT_NOT_FOUND",
    `path list not found: ${spec} (pass an on-disk list path, or pipe it: git diff --name-only HEAD~1 | jint paths -)`,
  );
}

/**
 * The list, one path per line: trimmed (CRLF tolerated), deduplicated (first occurrence wins),
 * order kept. NO path algebra — the entry string is the file's identity, so entries that would need
 * interpreting are rejected loud, not resolved: - `..` segments: rejected (would escape the input
 * dir); - trailing `/`: rejected (a list names FILES; a directory is a caller mistake, and reading
 * one as a file is not a note-worthy miss but a malformed list); - absolute paths: allowed
 * verbatim; - NUL bytes: rejected (git -z output is not a line-separated list).
 */
export function parsePathsList(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const path = raw.trim();
    if (path === "") continue;
    if (path.includes("\0")) {
      throw new SetupError(
        "ENTRYPOINT_UNREADABLE",
        `path list entries must be line-separated paths; NUL-separated input (git -z) is not a list`,
      );
    }
    if (path.endsWith("/")) {
      throw new SetupError(
        "CONFIG_INVALID",
        `path list entry names a directory (trailing /): "${path}" - a list names files`,
      );
    }
    if (path.split("/").includes("..")) {
      throw new SetupError(
        "CONFIG_INVALID",
        `path list entry escapes the input dir (".."): "${path}" - entries are relative to the input dir, or absolute`,
      );
    }
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}
