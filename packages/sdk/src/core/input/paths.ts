/**
 * The path-list parser (the CLI's `paths` noun): PURE — text in, entries out. The read lives at the
 * boundary that owns I/O (the CLI reads stdin and passes the text; the SDK takes values, the same
 * boundary as `str`'s already-read content). This is the caller's own pipeline — `git diff
 * --name-only HEAD~1 | jint paths -` — jint never shells out and never parses a VCS (pinned
 * contract, guarded by test).
 *
 * The list is ONE flat list of paths: no added/modified/removed split (that is the caller's git
 * vocabulary, not ours — `git diff --name-status | cut -f2` if they ever want it). Entries are
 * relative to the input dir or absolute; the entry string is used VERBATIM as the file's identity.
 */

import { SetupError } from "../types.ts";

/**
 * The list, one path per line: trimmed (CRLF tolerated), deduplicated (first occurrence wins),
 * order kept. The minimal plausibility rule: after trimming, a non-empty line IS a path entry — a
 * path may contain anything except NUL and newline (the separator; NUL in the BYTES is the reader's
 * rejection — LIST_UNREADABLE at the I/O boundary, not a parser question). Entries that would need
 * path INTERPRETATION are rejected loud, not resolved (LIST_ENTRY_INVALID): - `..` segments: would
 * escape the input dir; - trailing `/`: a list names FILES, and reading a directory as a file is a
 * malformed entry, not a note-worthy miss. Absolute paths are allowed verbatim. Everything else — a
 * prompt artifact, a status column, a typo — is the caller's bytes: it fails downstream as a
 * not-in-the-walk note, never a silent skip and never a sniff.
 */
export function parsePathsList(text: string): string[] {
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
