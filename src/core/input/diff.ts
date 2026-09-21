/**
 * Diff inputs: "-" (stdin, the primitive), an on-disk patch file, or a
 * rev-looking expression (sugar that shells out to git — fails loudly when git
 * is absent; pipe through "-" instead).
 *
 * A unified diff is decomposed into per-file units: added/modified files are
 * measured, deleted and binary files are skipped, and the commit message (when
 * available via git) is shared state for every unit of the run (design §4).
 */

import { stat, readFile } from "node:fs/promises";
import { AppError, type Unit } from "../types.ts";
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
    throw new AppError("ENTRYPOINT_NOT_FOUND", `unknown diff input: ${spec} (use "-" for stdin, a patch path, or a git rev)`);
  }
  const info = await stat(spec).catch(() => null);
  if (info?.isFile()) {
    return { text: await readText(spec), commitMessage: null };
  }
  return gitDiffSource(spec);
}

/**
 * Rev sugar — requires the git binary (documented stub); a missing git fails
 * loudly with the primitive as the next step.
 */
async function gitDiffSource(expr: string): Promise<DiffSource> {
  const git = Bun.which("git", { PATH: process.env.PATH });
  if (!git) {
    throw new AppError(
      "ENTRYPOINT_UNREADABLE",
      `git executable not found: cannot resolve diff '${expr}' — pipe the diff instead: git diff ${expr} | jint --diff -`,
    );
  }
  const [text, code, err] = await runGit(["diff", "--no-color", "--no-ext-diff", expr]);
  if (code !== 0) {
    throw new AppError("ENTRYPOINT_UNREADABLE", `git diff ${expr} failed (exit ${code}): ${err.trim() || "git error"}`);
  }
  return { text, commitMessage: await gitCommitMessage(expr) };
}

async function gitCommitMessage(expr: string): Promise<string | null> {
  const end = expr.includes("..") ? (expr.split("..").pop() ?? expr) : expr;
  const [out, code] = await runGit(["log", "-1", end]);
  if (code !== 0) return null;
  return out.trimEnd() || null;
}

async function runGit(args: string[]): Promise<[string, number, string]> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return [out, code, err];
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new AppError("ENTRYPOINT_UNREADABLE", `cannot read file: ${path}: ${detail}`, { cause: e });
  }
}

/** Split a unified diff into per-file blocks keyed on git headers, falling back to ---/+++ pairs. */
export function splitDiffBlocks(text: string): string[] {
  const lines = text.split("\n");
  const gitFormat = /^diff --git /m.test(text);
  const blocks: string[] = [];
  let current: string[] = [];
  let pairOpen = false; // a ---/+++ pair is in progress in the current (git-less) block
  const flush = () => {
    if (current.some((l) => l.trim() !== "")) blocks.push(current.join("\n"));
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
  return blocks;
}

interface BlockMeta {
  path: string;
  deleted: boolean;
  binary: boolean;
}

/** Extract the measured path and skip-worthiness from one diff block. */
export function parseDiffBlock(block: string): BlockMeta | null {
  const lines = block.split("\n");
  const gitHeader = lines.find((l) => l.startsWith("diff --git "));
  const plus = lines.find((l) => l.startsWith("+++ "));
  let rawPath: string | null = null;
  let deleted = /^deleted file mode/m.test(block);
  if (plus !== undefined) {
    const target = plus.slice(4).split("\t")[0]!.trim();
    if (target === "/dev/null") {
      // deletion: the surviving path lives on the --- side
      deleted = true;
      const minus = lines.find((l) => l.startsWith("--- "));
      rawPath = minus === undefined ? null : minus.slice(4).split("\t")[0]!.trim().replace(/^a\//, "") || null;
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
