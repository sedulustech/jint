/**
 * Diff sources: "-" (stdin, the SDK primitive) or an on-disk patch file. Jint never shells to git —
 * the caller owns the VCS and pipes the diff in (git diff HEAD~1 | jint diff -).
 *
 * A unified diff is split into per-file units: added/modified files are classified, deleted and
 * binary files are skipped (design §4).
 */

import { stat, readFile } from "node:fs/promises";
import { SetupError, type Unit } from "../types.ts";
import { compilePattern, type IgnoreRule } from "./dir.ts";

export interface DiffSource {
  text: string;
  commitMessage: string | null;
}

export async function readDiffSource(spec: string): Promise<DiffSource> {
  if (spec === "-") {
    return { text: await Bun.stdin.text(), commitMessage: null };
  }
  if (spec.startsWith("-") || spec.includes("\0")) {
    throw new SetupError(
      "ENTRYPOINT_NOT_FOUND",
      `unknown diff input: ${spec} (use "-" for stdin or pass an on-disk patch path)`,
    );
  }
  const info = await stat(spec).catch(() => null);
  if (info?.isFile()) {
    return { text: await readText(spec), commitMessage: null };
  }
  throw new SetupError(
    "ENTRYPOINT_NOT_FOUND",
    `diff input not found: ${spec} (pass an on-disk patch path, or pipe the diff: jint diff -)`,
  );
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new SetupError("ENTRYPOINT_UNREADABLE", `cannot read file: ${path}: ${detail}`, {
      cause: e,
    });
  }
}

/** Split a unified diff into per-file elements keyed on git headers, falling back to ---/+++ pairs. */
export function splitDiffBlocks(text: string): string[] {
  const lines = text.split("\n");
  const gitFormat = /^diff --git /m.test(text);
  const elements: string[] = [];
  // a ---/+++ pair is in progress in the current (git-less) block
  let current: string[] = [];
  let pairOpen = false;
  const flush = () => {
    if (current.some((l) => l.trim() !== "")) elements.push(current.join("\n"));
    current = [];
    pairOpen = false;
  };
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      current.push(line);
      continue;
    }
    // git-less (classic) diffs split on ---/+++ pairs; git-format diffs split
    // only on their headers, so hunk bodies starting with "---" stay intact
    if (!gitFormat && line.startsWith("--- ") && pairOpen) flush();
    if (line.startsWith("+++ ")) pairOpen = true;
    current.push(line);
  }
  flush();
  return elements;
}

interface BlockMeta {
  path: string;
  deleted: boolean;
  binary: boolean;
}

/** Extract the classified path and skip-worthiness from one diff block. */
export function parseDiffBlock(block: string): BlockMeta | null {
  const lines = block.split("\n");
  const gitHeader = lines.find((l) => l.startsWith("diff --git "));
  const plus = lines.find((l) => l.startsWith("+++ "));
  let rawPath: string | null = null;
  const deleted = /^deleted file mode/m.test(block);
  if (plus !== undefined) {
    const target = plus.slice(4).split("\t")[0]!.trim();
    if (target === "/dev/null") {
      // deletion: the surviving path lives on the --- side
      const minus = lines.find((l) => l.startsWith("--- "));
      rawPath =
        minus === undefined
          ? null
          : minus.slice(4).split("\t")[0]!.trim().replace(/^a\//, "") || null;
    } else {
      rawPath = target;
    }
  } else if (gitHeader !== undefined) {
    const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(gitHeader);
    if (match) rawPath = match[2]!;
  }
  if (rawPath === null) return null;
  const binary = /^GIT binary patch/m.test(block) || /^Binary files /m.test(block);
  const path = rawPath.replace(/^b\//, "");
  if (path === "") return null;
  return { path, deleted, binary };
}

export function* decomposeDiff(
  text: string,
  commitMessage: string | null,
  exclude?: readonly string[],
): Generator<Unit> {
  const excludeRules: IgnoreRule[] = (exclude ?? []).map(compilePattern);
  for (const block of splitDiffBlocks(text)) {
    const meta = parseDiffBlock(block);
    if (meta === null || meta.deleted || meta.binary) continue;
    if (excludeRules.some((rule) => !rule.dirOnly && rule.re.test(meta.path))) continue;
    yield { kind: "diff", state: { path: meta.path, diff: block, commit_message: commitMessage } };
  }
}
