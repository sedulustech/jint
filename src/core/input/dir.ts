/**
 * Directory walker: turns an on-disk directory into file units.
 *
 * Default exclusions: node_modules, .git, gitignored paths (the walker reads .gitignore files it
 * encounters), and binary files (extension + null-byte sniff). Config/CLI exclude patterns prune on
 * top.
 */

import { readdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { elementWireId } from "../sensors/classify.ts";
import { SetupError, type Unit } from "../types.ts";
import type { Dirent } from "node:fs";

const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".git"]);

const GITIGNORE_FILENAME = ".gitignore";

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".jar",
  ".wasm",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".sqlite",
  ".db",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".bin",
]);

const SNIFF_BYTES = 8192;

export interface IgnoreRule {
  re: RegExp;
  negated: boolean;
  dirOnly: boolean;
}

/** The gitignore rules in force for one directory, relative to that directory. */
interface IgnoreScope {
  /** Directory the rules are relative to, "" for the walk root. */
  base: string;
  rules: IgnoreRule[];
}

export async function* walkDir(root: string, exclude?: readonly string[]): AsyncGenerator<Unit> {
  const rootStat = await stat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT")
      throw new SetupError("ENTRYPOINT_NOT_FOUND", `directory not found: ${root}`);
    throw new SetupError(
      "ENTRYPOINT_UNREADABLE",
      `cannot read directory: ${root}: ${error.message}`,
      { cause: error },
    );
  });
  if (!rootStat.isDirectory()) {
    throw new SetupError("ENTRYPOINT_NOT_FOUND", `not a directory: ${root} (use --file)`);
  }
  const normalizedRoot = root.replace(/\/+$/, "");
  const excludeRules = (exclude ?? []).map(compilePattern);
  yield* walkDirectory(normalizedRoot, "", [{ base: "", rules: [] }], excludeRules);
}

/** Walk one directory level: scope its gitignore rules, then classify and handle each entry. */
async function* walkDirectory(
  absDir: string,
  relDir: string,
  inheritedScopes: IgnoreScope[],
  excludeRules: IgnoreRule[],
): AsyncGenerator<Unit> {
  const currentScopes = await withGitignore(absDir, relDir, inheritedScopes);
  const entries = (
    await readdir(absDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      throw new SetupError(
        "ENTRYPOINT_UNREADABLE",
        `cannot read directory: ${absDir}: ${error.message}`,
        { cause: error },
      );
    })
  ).sort(compareByName);

  for (const entry of entries) {
    const relativePath = joinRelativePath(relDir, entry.name);
    const absolutePath = join(absDir, entry.name);
    if (entry.isDirectory()) {
      yield* descendIntoDirectory(
        entry,
        absolutePath,
        relativePath,
        inheritedScopes,
        currentScopes,
        excludeRules,
      );
    } else if (entry.isFile()) {
      const unit = await readFileUnit(
        entry,
        absolutePath,
        relativePath,
        currentScopes,
        excludeRules,
      );
      if (unit !== null) yield unit;
    }
  }
}

/** Depth-first into one subdirectory, unless a default or configured exclusion prunes it. */
async function* descendIntoDirectory(
  entry: Dirent,
  absolutePath: string,
  relativePath: string,
  inheritedScopes: IgnoreScope[],
  currentScopes: IgnoreScope[],
  excludeRules: IgnoreRule[],
): AsyncGenerator<Unit> {
  if (DEFAULT_SKIP_DIRS.has(entry.name)) return;
  if (matchesAnyExcludeRule(excludeRules, relativePath, true)) return;
  if (isGitignored(relativePath, true, inheritedScopes)) return;
  yield* walkDirectory(absolutePath, relativePath, currentScopes, excludeRules);
}

/** One measured file unit, or null when a walker exclusion skips it. */
async function readFileUnit(
  entry: Dirent,
  absolutePath: string,
  relativePath: string,
  currentScopes: IgnoreScope[],
  excludeRules: IgnoreRule[],
): Promise<Unit | null> {
  // walker config, not measured code
  if (entry.name === GITIGNORE_FILENAME) return null;
  if (matchesAnyExcludeRule(excludeRules, relativePath, false)) return null;
  if (isGitignored(relativePath, false, currentScopes)) return null;
  if (BINARY_EXTENSIONS.has(fileExtension(entry.name))) return null;
  if (await looksBinary(absolutePath)) return null;
  const content = await readTextFile(absolutePath);
  return {
    kind: "file",
    state: {
      path: relativePath,
      content,
      id: elementWireId({ start: { line: 1 }, end: { line: content.split("\n").length } }),
    },
  };
}

/** Push this directory's .gitignore rules (if any) as the deepest scope. */
async function withGitignore(
  absDir: string,
  relDir: string,
  inheritedScopes: IgnoreScope[],
): Promise<IgnoreScope[]> {
  const path = join(absDir, GITIGNORE_FILENAME);
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch {
    // no .gitignore here — the catch-and-continue IS the not-present case
    return inheritedScopes;
  }
  const rules = parseGitignore(text);
  if (rules.length === 0) return inheritedScopes;
  return [...inheritedScopes, { base: relDir, rules }];
}

function compareByName(a: Dirent, b: Dirent): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function joinRelativePath(parentPath: string, name: string): string {
  return parentPath === "" ? name : `${parentPath}/${name}`;
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

/**
 * Last matching rule wins within a scope; the deepest scope with a match decides (git semantics,
 * bounded).
 */
function isGitignored(relativePath: string, isDirectory: boolean, scopes: IgnoreScope[]): boolean {
  for (let scopeIndex = scopes.length - 1; scopeIndex >= 0; scopeIndex--) {
    const scope = scopes[scopeIndex]!;
    const pathFromScopeBase =
      scope.base === ""
        ? relativePath
        : relativePath.startsWith(`${scope.base}/`)
          ? relativePath.slice(scope.base.length + 1)
          : "";
    if (pathFromScopeBase === "") continue;
    for (let ruleIndex = scope.rules.length - 1; ruleIndex >= 0; ruleIndex--) {
      const rule = scope.rules[ruleIndex]!;
      if (rule.dirOnly && !isDirectory) continue;
      if (rule.re.test(pathFromScopeBase)) return !rule.negated;
    }
  }
  return false;
}

/** True when any non-negated exclude rule matches (config/CLI patterns, not gitignore scopes). */
function matchesAnyExcludeRule(
  rules: IgnoreRule[],
  relativePath: string,
  isDirectory: boolean,
): boolean {
  return rules.some(
    (rule) => !rule.negated && !(rule.dirOnly && !isDirectory) && rule.re.test(relativePath),
  );
}

/** Compile one gitignore-flavored glob to an anchored RegExp over a relative path. */
export function compilePattern(pattern: string): IgnoreRule {
  let glob = pattern.replace(/^\.\//, "");
  let dirOnly = false;
  let negated = false;
  if (glob.startsWith("!")) {
    negated = true;
    glob = glob.slice(1);
  }
  if (glob.endsWith("/")) {
    dirOnly = true;
    glob = glob.slice(0, -1);
  }
  const anchored = glob.includes("/");
  if (glob.startsWith("/")) glob = glob.slice(1);
  const globBody = anchored ? glob : `**/${glob}`;
  return { re: globToRegExp(globBody), negated, dirOnly };
}

function globToRegExp(pattern: string): RegExp {
  let regexSource = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          regexSource += "(?:.*/)?";
          i += 2;
        } else {
          regexSource += ".*";
          i += 1;
        }
      } else {
        regexSource += "[^/]*";
      }
    } else if (char === "?") {
      regexSource += "[^/]";
    } else {
      regexSource += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regexSource}$`);
}

function fileExtension(name: string): string {
  const lastDotIndex = name.lastIndexOf(".");
  return lastDotIndex === -1 ? "" : name.slice(lastDotIndex).toLowerCase();
}

/** Null-byte sniff of the first SNIFF_BYTES: reading text later is wasted on binaries. */
async function looksBinary(absolutePath: string): Promise<boolean> {
  const fileHandle = await open(absolutePath, "r");
  try {
    const sniffBuffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fileHandle.read(sniffBuffer, 0, SNIFF_BYTES, 0);
    return sniffBuffer.subarray(0, bytesRead).includes(0);
  } finally {
    await fileHandle.close();
  }
}

/**
 * Read the unit's text, or fail loud: an unreadable entrypoint is setup, not a per-unit measure
 * error.
 */
async function readTextFile(absolutePath: string): Promise<string> {
  try {
    return await Bun.file(absolutePath).text();
  } catch (thrown) {
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    throw new SetupError("ENTRYPOINT_UNREADABLE", `cannot read file: ${absolutePath}: ${detail}`, {
      cause: thrown,
    });
  }
}
