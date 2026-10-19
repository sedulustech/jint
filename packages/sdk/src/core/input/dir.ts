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
 * per denylist class per walk (same doctrine as the other walker exclusions). The walker itself
 * only sees walked directories - a NAMED operand never enters walkDir; lint applies the same
 * denylist to named operands at admission (an always-win exclusion, not a selector: pattern-level
 * there, with this walk's PEM sniff staying walk-only).
 */

import { existsSync } from "node:fs";
import { readdir, open, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { elementWireId } from "../rules/classify.ts";
import { SetupError, type Unit } from "../types.ts";
import { inputStats, SKIP_REASONS, type InputStats } from "./stats.ts";
import type { Dirent } from "node:fs";

const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".git"]);

/**
 * The SECRET-SHAPED DENYLIST (frozen default; overridable through config). Patterns are
 * gitignore-flavored, composed as the shallowest ignore scope (negations inside the list work; a
 * deeper .gitignore/config negation re-admits). The leak audit is the reason none may reach the
 * classifier - gitignored or not.
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

/**
 * One scope: a named owner of include patterns. The CONFIG scope (by: "config") is the include
 * whitelist run/capture always had; every RULE scope (by: "rule:<name>") is one rule's declared
 * include - the walk-union contract (a rule that names a file claims jurisdiction over it, even
 * where the config exclude would drop it: the more specific scope wins, gitignore style). A file is
 * walked when ANY scope admits it; each rule then measures only files its own scope admits.
 */
export interface OwnedScope {
  /** Scope owner: "config" or "rule:<rule name>" (attribution for run.input.admitted). */
  readonly by: string;
  /** Include patterns; the config scope with ZERO patterns admits everything (include = []). */
  readonly patterns: readonly string[];
  /** Rule scopes only: the rule's own exclude - a rule that excludes a file does not claim it. */
  readonly exclude?: readonly string[];
}

interface CompiledScope {
  readonly by: string;
  readonly rules: readonly IgnoreRule[];
  /** Rule scopes only: the rule's own compiled exclude. */
  readonly excludeRules: readonly IgnoreRule[];
  /** The config scope only: zero patterns = match everything. */
  readonly matchAll: boolean;
  /**
   * The ONE claim test (scope.ts ruleScopeClaims' semantics, precompiled): include match AND the
   * rule's own exclude does not subtract.
   */
  claims(path: string): boolean;
}

function compileScopes(scopes: readonly OwnedScope[]): CompiledScope[] {
  return scopes.map((scope) => {
    const excludeRules = (scope.exclude ?? []).map(compilePattern);
    return {
      by: scope.by,
      rules: scope.patterns.map(compilePattern),
      excludeRules,
      matchAll: scope.by === "config" && scope.patterns.length === 0,
      claims:
        scope.by === "config"
          ? () => false
          : (path) =>
              scope.patterns.some((p) => patternMatchesFile(compilePattern(p), path)) &&
              !excludeRules.some((r) => patternMatchesFile(r, path)),
    };
  });
}

/** First scope whose patterns admit the file (config scope first in the list wins ties). */
function firstAdmittingScope(
  scopes: readonly CompiledScope[],
  scopePath: string,
): CompiledScope | null {
  for (const scope of scopes) {
    if (scope.matchAll) return scope;
    if (scope.rules.some((rule) => patternMatchesFile(rule, scopePath))) return scope;
  }
  return null;
}

export async function* walkDir(
  root: string,
  exclude?: readonly string[],
  pathPrefix?: string,
  include?: readonly OwnedScope[],
  secretDenylist?: readonly string[],
  onNote?: (note: string) => void,
  stats: InputStats = inputStats(),
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
  const scopes = include === undefined ? [] : compileScopes(include);
  const deny = denyState(secretDenylist ?? SECRET_DENYLIST, onNote);
  // the denylist is the SHALLOWEST scope: deeper .gitignore scopes (and the list's own
  // negations) compose with ordinary last-match-wins semantics
  yield* walkDirectory(
    normalizedRoot,
    "",
    [deny.scope, ...ancestorScopes],
    excludeRules,
    exclude ?? [],
    prefix,
    scopes,
    deny,
    stats,
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
  excludeGlobs: readonly string[],
  pathPrefix: string,
  scopes: readonly CompiledScope[],
  deny: DenyState,
  stats?: InputStats,
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
        excludeGlobs,
        pathPrefix,
        scopes,
        deny,
        stats,
      );
    } else if (entry.isFile()) {
      const unit = await readFileUnit(
        entry,
        absolutePath,
        relativePath,
        currentScopes,
        excludeRules,
        excludeGlobs,
        pathPrefix,
        scopes,
        deny,
        stats,
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
  excludeGlobs: readonly string[],
  pathPrefix: string,
  scopes: readonly CompiledScope[],
  deny: DenyState,
  stats?: InputStats,
): AsyncGenerator<Unit> {
  const scopePath = pathPrefix === "" ? relativePath : `${pathPrefix}/${relativePath}`;
  if (DEFAULT_SKIP_DIRS.has(entry.name)) return;
  // a pruned DIRECTORY owns one excluded tally (its glob, first match); the files within were
  // never discovered, so they are counted nowhere else
  const dirExcludeMatch = firstExcludeMatch(excludeRules, scopePath, true);
  if (dirExcludeMatch !== -1) {
    stats?.tallyExclude(excludeGlobs[dirExcludeMatch] ?? "");
    return;
  }
  // the denylist scope rides the inherited scopes: a secret-shaped DIRECTORY prunes too
  if (isSecretShaped(relativePath, true, inheritedScopes, deny)) {
    stats?.tallySkip(SKIP_REASONS.denylist);
    return;
  }
  if (isGitignored(relativePath, true, inheritedScopes)) {
    stats?.tallySkip(SKIP_REASONS.gitignore);
    return;
  }
  yield* walkDirectory(
    absolutePath,
    relativePath,
    currentScopes,
    excludeRules,
    excludeGlobs,
    pathPrefix,
    scopes,
    deny,
    stats,
  );
}

/** One classified file unit, or null when a walker exclusion skips it. */
async function readFileUnit(
  entry: Dirent,
  absolutePath: string,
  relativePath: string,
  currentScopes: IgnoreScope[],
  excludeRules: IgnoreRule[],
  excludeGlobs: readonly string[],
  pathPrefix: string,
  scopes: readonly CompiledScope[],
  deny: DenyState,
  stats?: InputStats,
): Promise<Unit | null> {
  // walker config, not classified code
  if (entry.name === GITIGNORE_FILENAME) return null;
  // discovered: the walker opened this file's scopes - every drop below is accounted
  stats?.markDiscovered();
  const scopePath = pathPrefix === "" ? relativePath : `${pathPrefix}/${relativePath}`;
  // WALK-UNION admission: a rule scope that matches the file CLAIMS JURISDICTION over it -
  // even where the config exclude would drop it (the more specific scope wins; the denylist
  // and gitignore scopes below are SAFETY scopes and never yield). Jurisdiction is independent of
  // the config scope: a rule claims its file whether or not the config include also matches, so
  // the claim test runs on the rule scopes alone. Attribution stays first-match (config first)
  // EXCEPT where the claim SAVED the file from the exclude - then the saving scope owns it.
  // the claim test is ruleScopeClaims' semantics (scope.ts) inlined over the compiled scopes:
  // include match AND the rule's own exclude does not subtract - one semantics, both consumers
  const claim = scopes.find((scope) => scope.claims(scopePath));
  const excludeMatch = firstExcludeMatch(excludeRules, scopePath, false);
  if (claim === undefined || excludeMatch === -1) {
    if (excludeMatch !== -1) {
      stats?.tallyExclude(excludeGlobs[excludeMatch] ?? "");
      return null;
    }
    // scopes exist but none admits: outside every include list
    const admittingScope = firstAdmittingScope(scopes, scopePath);
    if (scopes.length > 0 && admittingScope === null) {
      stats?.tallySkip(SKIP_REASONS.notInInclude);
      return null;
    }
    stats?.tallyAdmit(admittingScope === null ? "config" : admittingScope.by);
  } else {
    // the rule scope saved this file from the config exclude: it is the admitting scope
    stats?.tallyAdmit(claim.by);
  }
  if (isSecretShaped(relativePath, false, currentScopes, deny)) {
    stats?.tallySkip(SKIP_REASONS.denylist);
    return null;
  }
  if (isGitignored(relativePath, false, currentScopes)) {
    stats?.tallySkip(SKIP_REASONS.gitignore);
    return null;
  }
  if (BINARY_EXTENSIONS.has(fileExtension(entry.name))) {
    stats?.tallySkip(SKIP_REASONS.binary);
    return null;
  }
  const sniff = await sniffHead(absolutePath);
  // null head = a null byte in the first SNIFF_BYTES: binary, reading text later is wasted
  if (sniff === null) {
    stats?.tallySkip(SKIP_REASONS.binary);
    return null;
  }
  // PEM content backstop: overrides even a re-admitting negation - the bytes are the secret
  if (sniff.startsWith(PEM_HEADER)) {
    stats?.tallySkip(SKIP_REASONS.denylist);
    deny.pem += 1;
    return null;
  }
  stats?.markIncluded();
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
 * must inherit them, or the walk root's ignore rules leak into a deeper-rooted walk. Ordered
 * shallow-to-deep: deeper scopes still win, like git.
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
/** Push this directory's ignore rules (if any) as the deepest scope. */
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
 * last-match-wins (a re-admitting negation wins), except the armor sniff never re-admits. Records
 * the matched class for reporting.
 */
function isSecretShaped(
  relativePath: string,
  isDirectory: boolean,
  deeperScopes: IgnoreScope[],
  deny: DenyState,
): boolean {
  const denied = isGitignored(relativePath, isDirectory, [deny.scope, ...deeperScopes]);
  if (!denied) return false;
  // the matched class is the first denylist pattern that hit; fall back to the generic class
  const matched =
    deny.classes.find((c) => !(c.rule.dirOnly && !isDirectory) && c.rule.re.test(relativePath))
      ?.pattern ?? "secret-shaped";
  deny.counts.set(matched, (deny.counts.get(matched) ?? 0) + 1);
  return true;
}

/**
 * The secret-shaped denylist evaluated for ONE NAMED operand (the walk composes the denylist as a
 * scope with negations; the operand case is a pattern-level test - the named path either is
 * secret-shaped or it is not). Returns the matched pattern, null when the path is clean. The PEM
 * content sniff stays walk-only: a name under an innocent name is explicit consent the same way
 * piped source is; the pattern check covers the leak audit's threat (secret-shaped NAMES).
 */
export function denylistMatch(
  path: string,
  patterns: readonly string[] = SECRET_DENYLIST,
): string | null {
  for (const pattern of patterns) {
    const rule = compilePattern(pattern);
    if (!rule.negated && patternMatchesFile(rule, path)) return pattern;
  }
  return null;
}

/**
 * THE one file/pattern matcher (walk-union collapse): dirOnly semantics live here, consumed by the
 * walker's scopes AND scope.ts's per-rule scoping - one semantics, two callers, no second
 * derivation to drift (review 396888e finding 2 was exactly that drift). A non-dirOnly pattern
 * tests the path itself; a dirOnly pattern (trailing slash - "tests/") names a directory, so it
 * matches a file when ANY ancestor directory of the path satisfies the pattern's regex.
 */
export function patternMatchesFile(rule: IgnoreRule, path: string): boolean {
  if (!rule.dirOnly) return rule.re.test(path);
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) {
    if (rule.re.test(parts.slice(0, i).join("/"))) return true;
  }
  return false;
}

/** Index of the FIRST non-negated exclude rule matching (first-match attribution), -1 when none. */
function firstExcludeMatch(
  rules: IgnoreRule[],
  relativePath: string,
  isDirectory: boolean,
): number {
  return rules.findIndex(
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
