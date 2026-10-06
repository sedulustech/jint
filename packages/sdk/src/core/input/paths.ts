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

/**
 * Read the declared list as TEXT, and only text. The read is byte-capped on the raw bytes (both
 * ingestion paths), then the bytes must decode as UTF-8: binary or otherwise undecodable input is
 * LIST_UNREADABLE — the list is never sniffed, so garbage fails loud here instead of degrading into
 * mystery "not found in the walk" notes.
 */
export async function readPathsSource(spec: string): Promise<string> {
  const bytes =
    spec === "-"
      ? new Uint8Array(await Bun.stdin.arrayBuffer())
      : await (async () => {
          const info = await stat(spec).catch(() => null);
          if (!info?.isFile()) {
            throw new SetupError(
              "ENTRYPOINT_NOT_FOUND",
              `path list not found: ${spec} (pass an on-disk list path, or pipe it: git diff --name-only HEAD~1 | jint paths -)`,
            );
          }
          if (info.size > MAX_LIST_BYTES) {
            throw new SetupError(
              "ENTRYPOINT_UNREADABLE",
              `path list exceeds the ${MAX_LIST_BYTES} byte cap: ${spec} is ${info.size} bytes`,
            );
          }
          return new Uint8Array(await readFile(spec));
        })();
  if (bytes.byteLength > MAX_LIST_BYTES) {
    throw new SetupError(
      "ENTRYPOINT_UNREADABLE",
      `path list exceeds the ${MAX_LIST_BYTES} byte cap: ${bytes.byteLength} bytes`,
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SetupError(
      "LIST_UNREADABLE",
      `path list is not UTF-8 text (${bytes.byteLength} bytes) - binary input is not a path list (a list is one path per line)`,
    );
  }
}

/**
 * The list, one path per line: trimmed (CRLF tolerated), deduplicated (first occurrence wins),
 * order kept. The minimal plausibility rule: after trimming, a non-empty line IS a path entry — a
 * path may contain anything except NUL and newline (the separator), so nothing else about a line is
 * judged. NUL anywhere in the input is the one byte-level rejection (LIST_UNREADABLE: git -z output
 * is not a line-separated list). Entries that would need path INTERPRETATION are rejected loud, not
 * resolved (LIST_ENTRY_INVALID): - `..` segments: would escape the input dir; - trailing `/`: a
 * list names FILES, and reading a directory as a file is a malformed entry, not a note-worthy miss.
 * Absolute paths are allowed verbatim. Everything else — a prompt artifact, a status column, a typo
 * — is the caller's bytes: it fails downstream as a not-in-the-walk note, never a silent skip and
 * never a sniff.
 */
export function parsePathsList(text: string): string[] {
  if (text.includes("\0")) {
    throw new SetupError(
      "LIST_UNREADABLE",
      "path list entries must be line-separated paths; NUL-separated input (git -z) is not a list",
    );
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const path = raw.trim();
    if (path === "") continue;
    if (path.endsWith("/")) {
      throw new SetupError(
        "LIST_ENTRY_INVALID",
        `path list entry names a directory (trailing /): "${path}" - a list names files`,
      );
    }
    if (path.split("/").includes("..")) {
      throw new SetupError(
        "LIST_ENTRY_INVALID",
        `path list entry escapes the input dir (".."): "${path}" - entries are relative to the input dir, or absolute`,
      );
    }
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}
