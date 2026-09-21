/**
 * Directory walker: turns an on-disk directory into file units.
 *
 * Default exclusions: node_modules, .git, gitignored paths (the walker reads
 * .gitignore files it encounters), and binary files (extension + null-byte
 * sniff). Config/CLI exclude patterns prune on top.
 */

import { readdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { AppError, type Unit } from "../types.ts";

const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".git"]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".jar", ".wasm",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".mov",
  ".avi", ".sqlite", ".db", ".so", ".dylib", ".dll", ".exe", ".bin",
]);

const SNIFF_BYTES = 8192;

export interface IgnoreRule {
  re: RegExp;
  negated: boolean;
  dirOnly: boolean;
}

interface RuleSet {
  /** Directory the rules are relative to, "" for the walk root. */
  base: string;
  rules: IgnoreRule[];
}

export async function* walkDir(root: string, exclude?: readonly string[]): AsyncGenerator<Unit> {
  const info = await stat(root).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") throw new AppError("ENTRYPOINT_NOT_FOUND", `directory not found: ${root}`);
    throw new AppError("ENTRYPOINT_UNREADABLE", `cannot read directory: ${root}: ${e.message}`, { cause: e });
  });
  if (!info.isDirectory()) {
    throw new AppError("ENTRYPOINT_NOT_FOUND", `not a directory: ${root} (use --file)`);
  }
  const base = root.replace(/\/+$/, "");
  const excludeRules = (exclude ?? []).map(compilePattern);
  yield* walk(base, "", [{ base: "", rules: [] }], excludeRules);
}

async function* walk(
  absDir: string,
  relDir: string,
  stack: RuleSet[],
  excludeRules: IgnoreRule[],
): AsyncGenerator<Unit> {
  const myStack = await withGitignore(absDir, relDir, stack);
  const entries = (await readdir(absDir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
    throw new AppError("ENTRYPOINT_UNREADABLE", `cannot read directory: ${absDir}: ${e.message}`, { cause: e });
  })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (DEFAULT_SKIP_DIRS.has(entry.name)) continue;
      if (matchesAny(excludeRules, rel, true)) continue;
      if (ignored(rel, true, stack)) continue;
      yield* walk(abs, rel, myStack, excludeRules);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name === ".gitignore") continue; // walker config, not measured code
    if (matchesAny(excludeRules, rel, false)) continue;
    if (ignored(rel, false, myStack)) continue;
    if (BINARY_EXTENSIONS.has(ext(entry.name))) continue;
    if (await looksBinary(abs)) continue;
    let content: string;
    try {
      content = await Bun.file(abs).text();
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new AppError("ENTRYPOINT_UNREADABLE", `cannot read file: ${abs}: ${detail}`, { cause: e });
    }
    yield { kind: "file", state: { path: rel, content } };
  }
}

/** Push this directory's .gitignore rules (if any) as the deepest scope. */
async function withGitignore(absDir: string, relDir: string, stack: RuleSet[]): Promise<RuleSet[]> {
  const path = join(absDir, ".gitignore");
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch {
    return stack; // no .gitignore here — the catch-and-continue IS the not-present case
  }
  const rules = parseGitignore(text);
  if (rules.length === 0) return stack;
  return [...stack, { base: relDir, rules }];
}

export function parseGitignore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (line === "" || line.startsWith("#")) continue;
    let pattern = line;
    let negated = false;
    if (pattern.startsWith("!")) {
      negated = true;
      pattern = pattern.slice(1);
    }
    let dirOnly = false;
    if (pattern.endsWith("/")) {
      dirOnly = true;
      pattern = pattern.slice(0, -1);
    }
    if (pattern === "") continue;
    rules.push({ re: compilePattern(pattern).re, negated, dirOnly });
  }
  return rules;
}

/** Last matching rule wins within a set; the deepest set with a match decides (git semantics, bounded). */
function ignored(relPath: string, isDir: boolean, stack: RuleSet[]): boolean {
  for (let s = stack.length - 1; s >= 0; s--) {
    const set = stack[s]!;
    const relToBase = set.base === "" ? relPath : relPath.startsWith(`${set.base}/`) ? relPath.slice(set.base.length + 1) : "";
    if (relToBase === "") continue;
    for (let r = set.rules.length - 1; r >= 0; r--) {
      const rule = set.rules[r]!;
      if (rule.dirOnly && !isDir) continue;
      if (rule.re.test(relToBase)) return !rule.negated;
    }
  }
  return false;
}

function matchesAny(rules: IgnoreRule[], relPath: string, isDir: boolean): boolean {
  return rules.some((rule) => !rule.negated && !(rule.dirOnly && !isDir) && rule.re.test(relPath));
}

/** Compile one gitignore-flavored glob to an anchored RegExp over a relative path. */
export function compilePattern(pattern: string): IgnoreRule {
  let p = pattern.replace(/^\.\//, "");
  let dirOnly = false;
  let negated = false;
  if (p.startsWith("!")) {
    negated = true;
    p = p.slice(1);
  }
  if (p.endsWith("/")) {
    dirOnly = true;
    p = p.slice(0, -1);
  }
  const anchored = p.includes("/");
  if (p.startsWith("/")) p = p.slice(1);
  const body = anchored ? p : `**/${p}`;
  return { re: globToRegExp(body), negated, dirOnly };
}

function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

async function looksBinary(absPath: string): Promise<boolean> {
  const handle = await open(absPath, "r");
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}
