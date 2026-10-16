/**
 * Directory walker: turns an on-disk directory into file units.
 *
 * Default exclusions: node_modules, .git, gitignored paths (the walker reads .gitignore files it
 * encounters), and binary files (extension + null-byte sniff). Config/CLI exclude patterns prune on
 * top. SECRET-SHAPED DENYLIST (owner decision after the leak audit): secret-shaped files are
 * skipped ON TOP OF the parsed gitignore rules, composed at the SAME lifecycle stage - the denylist
 * is the SHALLOWEST ignore scope, so gitignore/config negations compose like ordinary rules (a
 * `!keep.pem` deeper scope re-admits). EXCEPT the PEM sniff: a file whose first bytes are
 * `-----BEGIN ` is skipped even when a negation re-admitted it. Skips are signal: ONE coverage note
 * per denylist class per walk (same doctrine as the other walker exclusions). Explicitly passed
 * single files bypass the denylist entirely (explicit path = consent; resolveInput's file path
 * never enters walkDir).
 */

import { existsSync } from "node:fs";
import { readdir, open, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { elementWireId } from "../rules/classify.ts";
import { SetupError, type Unit } from "../types.ts";
import type { Dirent } from "node:fs";

const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".git"]);

/**
 * The SECRET-SHAPED DENYLIST (frozen default; config-overridable via `secretDenylist`). Patterns
 * are gitignore-flavored, composed as the shallowest ignore scope (negations inside the list work;
 * a deeper .gitignore/config negation re-admits). The leak audit found .env / id_rsa / *.pem /
 * .npmrc all reaching the classifier when not gitignored - none may, gitignore or no gitignore.
 */
export const SECRET_DENYLIST: readonly string[] = Object.freeze([
  ".env",
  ".env.*",
  "*.env",
  ".npmrc",
  ".envrc",
  "credentials",
  "id_*",
  "*.pem",
  "*.key",
  "secrets*",
  ".netrc",
  ".pgpass",
]);

/** First bytes of any PEM armor (a content backstop: overrides even a re-admitting negation). */
const PEM_HEADER = "-----BEGIN ";

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
  /** Ancestor scopes only: the walk root path relative to this scope directory; "" at/below root. */
  prefix: string;
  rules: IgnoreRule[];
}

export async function* walkDir(
  root: string,
  exclude?: readonly string[],
  pathPrefix?: string,
  include?: readonly string[],
  secretDenylist?: readonly string[],
  onNote?: (note: string) => void,
): AsyncGenerator<Unit> {
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
    throw new SetupError("ENTRYPOINT_NOT_FOUND", `not a directory: ${root}`);
  }
  const normalizedRoot = root.replace(/\/+$/, "");
  const excludeRules = (exclude ?? []).map(compilePattern);
  const ancestorScopes = await ancestorGitignoreScopes(normalizedRoot);
  const prefix = pathPrefix === undefined ? "" : pathPrefix.replace(/\/+$/, "");
  const includeRules = (include ?? []).map(compilePattern);
  const deny = denyState(secretDenylist ?? SECRET_DENYLIST, onNote);
  // the denylist is the SHALLOWEST scope: deeper .gitignore scopes (and the list's own
  // negations) compose with ordinary last-match-wins semantics
  yield* walkDirectory(
    normalizedRoot,
    "",
    [deny.scope, ...ancestorScopes],
    excludeRules,
    prefix,
    includeRules,
    deny,
  );
  flushDenyNotes(deny);
}

/** Per-walk denylist state: the scope, per-class skip counts, the PEM-sniff count, the note sink. */
interface DenyState {
  readonly scope: IgnoreScope;
  /** Class = the denylist pattern string; the coverage note names classes, never paths. */
  readonly classes: readonly { readonly pattern: string; readonly rule: IgnoreRule }[];
  readonly counts: Map<string, number>;
  pem: number;
  readonly note?: (note: string) => void;
}

function denyState(patterns: readonly string[], note?: (note: string) => void): DenyState {
  const classes = patterns.map((pattern) => ({ pattern, rule: compilePattern(pattern) }));
  return {
    // base "" and prefix "" make every walked path evaluate against the patterns verbatim
    scope: { base: "", prefix: "", rules: classes.map((c) => c.rule) },
    classes,
    counts: new Map(),
    pem: 0,
    note,
  };
}

/** ONE coverage note per denylist class (signal, not silence - the walker-exclusions doctrine). */
function flushDenyNotes(deny: DenyState): void {
  if (deny.note === undefined) return;
  for (const [pattern, count] of deny.counts) {
    if (count > 0) deny.note(`secret denylist skipped ${count} path(s) matching '${pattern}'`);
  }
  if (deny.pem > 0) {
    deny.note(`secret denylist skipped ${deny.pem} path(s) with a PEM header ('${PEM_HEADER}')`);
  }
}

/** Walk one directory level: scope its gitignore rules, then classify and handle each entry. */
async function* walkDirectory(
  absDir: string,
  relDir: string,
  inheritedScopes: IgnoreScope[],
  excludeRules: IgnoreRule[],
  pathPrefix: string,
  includeRules: IgnoreRule[],
  deny: DenyState,
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
        pathPrefix,
        includeRules,
        deny,
      );
    } else if (entry.isFile()) {
      const unit = await readFileUnit(
        entry,
        absolutePath,
        relativePath,
        currentScopes,
        excludeRules,
        pathPrefix,
        includeRules,
        deny,
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
  pathPrefix: string,

  includeRules: IgnoreRule[],
  deny: DenyState,
): AsyncGenerator<Unit> {
  const scopePath = pathPrefix === "" ? relativePath : `${pathPrefix}/${relativePath}`;
  if (DEFAULT_SKIP_DIRS.has(entry.name)) return;
  if (matchesAnyExcludeRule(excludeRules, scopePath, true)) return;
  // the denylist scope rides inheritedScopes: a secret-shaped DIRECTORY (id_rsa/) prunes too
  if (isSecretShaped(relativePath, true, inheritedScopes, deny)) return;
  if (isGitignored(relativePath, true, inheritedScopes)) return;
  yield* walkDirectory(
    absolutePath,
    relativePath,
    currentScopes,
    excludeRules,
    pathPrefix,
    includeRules,
    deny,
  );
}

/** One classified file unit, or null when a walker exclusion skips it. */
async function readFileUnit(
  entry: Dirent,
  absolutePath: string,
  relativePath: string,
  currentScopes: IgnoreScope[],
  excludeRules: IgnoreRule[],
  pathPrefix: string,
  includeRules: IgnoreRule[],
  deny: DenyState,
): Promise<Unit | null> {
  // walker config, not classified code
  if (entry.name === GITIGNORE_FILENAME) return null;
  const scopePath = pathPrefix === "" ? relativePath : `${pathPrefix}/${relativePath}`;
  if (matchesAnyExcludeRule(excludeRules, scopePath, false)) return null;
  if (includeRules.length > 0 && !matchesAnyIncludeRule(includeRules, scopePath)) return null;
  if (isSecretShaped(relativePath, false, currentScopes, deny)) return null;
  if (isGitignored(relativePath, false, currentScopes)) return null;
  if (BINARY_EXTENSIONS.has(fileExtension(entry.name))) return null;
  const sniff = await sniffHead(absolutePath);
  // null head = a null byte in the first SNIFF_BYTES: binary, reading text later is wasted
  if (sniff === null) return null;
  // PEM content backstop: overrides even a re-admitting negation - the bytes are the secret
  if (sniff.startsWith(PEM_HEADER)) {
    deny.pem += 1;
    return null;
  }
  const content = await readTextFile(absolutePath);
  return {
    kind: "file",
    state: {
      path: pathPrefix === "" ? relativePath : `${pathPrefix}/${relativePath}`,
      content,
      id: elementWireId({ start: { line: 1 }, end: { line: content.split("\n").length } }),
    },
  };
}

/**
 * Collect .gitignore scopes from the walk root ANCESTORS, up to and including the repo top (nearest
 * directory containing .git). Git applies those files to everything below; a walk rooted deeper
 * must inherit them, or the root .gitignore's dist/ and tmp/ leak into a packages-rooted walk.
 * Ordered shallow-to-deep: deeper scopes still win, like git.
 */
async function ancestorGitignoreScopes(normalizedRoot: string): Promise<IgnoreScope[]> {
  const ancestors: { dir: string; prefixFromRoot: string }[] = [];
  let dir = dirname(normalizedRoot);
  let prefix = basename(normalizedRoot);
  for (;;) {
    ancestors.push({ dir, prefixFromRoot: prefix });
    if (existsSync(join(dir, ".git"))) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    prefix = `${basename(dir)}/${prefix}`;
    dir = parent;
  }
  const scopes: IgnoreScope[] = [];
  // no repo above the walk root: git applies nothing there, neither do we
  if (!ancestors.some((level) => existsSync(join(level.dir, ".git")))) return scopes;
  for (const level of ancestors.reverse()) {
    try {
      const text = await Bun.file(join(level.dir, GITIGNORE_FILENAME)).text();
      const rules = parseGitignore(text);
      if (rules.length > 0) scopes.push({ base: "", prefix: level.prefixFromRoot, rules });
    } catch {
      // no .gitignore at this level
    }
  }
  return scopes;
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
  return [...inheritedScopes, { base: relDir, prefix: "", rules }];
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
      scope.prefix !== ""
        ? `${scope.prefix}/${relativePath}`
        : scope.base === ""
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

/**
 * Secret-shaped path test: the denylist scope composes with the deeper scopes by ordinary
 * last-match-wins (a re-admitting negation wins), except the PEM sniff never re-admits. Records the
 * class for the coverage note.
 */
function isSecretShaped(
  relativePath: string,
  isDirectory: boolean,
  deeperScopes: IgnoreScope[],
  deny: DenyState,
): boolean {
  const denied = isGitignored(relativePath, isDirectory, [deny.scope, ...deeperScopes]);
  if (!denied) return false;
  // class = the first denylist pattern that matches (the note names the class, not the path)
  const matched =
    deny.classes.find((c) => !(c.rule.dirOnly && !isDirectory) && c.rule.re.test(relativePath))
      ?.pattern ?? "secret-shaped";
  deny.counts.set(matched, (deny.counts.get(matched) ?? 0) + 1);
  return true;
}

/** True when any include rule matches; an empty list matches everything. */
function matchesAnyIncludeRule(rules: IgnoreRule[], scopePath: string): boolean {
  return rules.some((rule) => !rule.dirOnly && rule.re.test(scopePath));
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

/** The file's head text, or null when the head carries a null byte (binary). */
async function sniffHead(absolutePath: string): Promise<string | null> {
  const fileHandle = await open(absolutePath, "r");
  try {
    const sniffBuffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fileHandle.read(sniffBuffer, 0, SNIFF_BYTES, 0);
    const head = sniffBuffer.subarray(0, bytesRead);
    if (head.includes(0)) return null;
    return head.toString("utf8");
  } finally {
    await fileHandle.close();
  }
}

/**
 * Read the unit's text, or fail loud: an unreadable entrypoint is setup, not a per-unit classify
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
