/**
 * Input inference and resolution (design §3, §4): the kind is inferred, not
 * configured —
 *
 *   on-disk directory            -> dir (walked into file units)
 *   on-disk file, diff content   -> diff (decomposed into per-file units)
 *   on-disk file, any other      -> file
 *   rev-looking non-path         -> diff via git
 *   "-"                          -> diff from stdin (the primitive)
 *
 * The CLI's --file/--dir/--diff flags are this same resolver in override form.
 * Both the CLI and the SDK go through resolveInput — no drift.
 */

import { stat } from "node:fs/promises";
import { AppError, type InputKind, type Unit } from "../types.ts";
import { fileUnit } from "./file.ts";
import { walkDir } from "./dir.ts";
import { readDiffSource, decomposeDiff } from "./diff.ts";

export interface ResolveOptions {
  input: string | string[];
  inputType?: InputKind;
  /** Extra input exclusions (config exclude + CLI --exclude union). */
  exclude?: readonly string[];
}

export async function inferKind(input: string): Promise<InputKind> {
  if (input === "-") return "diff";
  const info = await stat(input).catch(() => null);
  if (info?.isDirectory()) return "dir";
  if (info?.isFile()) {
    return looksLikeDiff(await readHead(input)) ? "diff" : "file";
  }
  if (looksLikeRev(input)) return "diff"; // git decides for real; failure surfaces loudly there
  throw new AppError(
    "ENTRYPOINT_NOT_FOUND",
    `input not found: ${input}` + (looksLikeRevShaped(input) ? " (git could not resolve it as a rev, either)" : ""),
  );
}

export function resolveInput(options: ResolveOptions): AsyncIterable<Unit> {
  const { input, inputType, exclude } = options;
  return (async function* () {
    if (Array.isArray(input)) {
      for (const path of input) yield await fileUnit(path); // explicit --file paths bypass exclude
      return;
    }
    const kind = inputType ?? (await inferKind(input));
    if (kind === "file") {
      yield await fileUnit(input);
      return;
    }
    if (kind === "dir") {
      yield* walkDir(input, exclude);
      return;
    }
    const source = await readDiffSource(input);
    yield* decomposeDiff(source.text, source.commitMessage, exclude);
  })();
}

const DIFF_HEAD_BYTES = 4096;

async function readHead(path: string): Promise<string> {
  const handle = Bun.file(path);
  return handle.slice(0, DIFF_HEAD_BYTES).text();
}

/** Unified-diff-looking content: git headers, classic ---/+++ pairs, or hunk headers. */
export function looksLikeDiff(text: string): boolean {
  const head = text.slice(0, DIFF_HEAD_BYTES);
  if (/^diff --git /m.test(head)) return true;
  if (/^diff -\w*/m.test(head) && /^--- /m.test(head)) return true;
  if (/^Index: /m.test(head) && /^--- /m.test(head)) return true;
  return /^--- .+\n\+\+\+ .+\n@@ -/m.test(head);
}

const REV_HEADISH = /^(?:HEAD|ORIG_HEAD|FETCH_HEAD|MERGE_HEAD|@)(?:[~^]\d*)?$/;
const REV_SHA = /^[0-9a-f]{7,40}$/i;
const REV_UPSTREAM = /^[\w.-]+\/[\w-]+$/; // no dots in the last segment: origin/main yes, src/foo.ts no

/** Cheap, conservative rev-shape check; git has the final word at resolution time. */
export function looksLikeRevShaped(input: string): boolean {
  if (input === "" || input.startsWith("-") || input.includes(":")) return false;
  if (input.includes("..")) return true;
  if (/[~^]/.test(input)) return true;
  return REV_HEADISH.test(input) || REV_SHA.test(input) || REV_UPSTREAM.test(input);
}

function looksLikeRev(input: string): boolean {
  return looksLikeRevShaped(input);
}
