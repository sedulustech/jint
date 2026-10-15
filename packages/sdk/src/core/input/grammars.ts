/**
 * The grammar registry: which languages exist, which wasm serves each parse, which .scm turns its
 * tree into elements. Embedded grammars are NOT special: each embedded/<lang>/ directory carries
 * the same three artifacts a user grammar dir holds — <lang>.wasm (parse), <lang>.manifest.json
 * (facts: version, extensions), queries.scm (extraction patterns) — and registers through the same
 * shape a user grammar uses at runtime. A user grammar dir ($JINT_DIR/grammars, default
 * ~/.jint/grammars) registers at lint start: a user wasm wins over embedded for the same language,
 * and a manifest+scm without a wasm shadows an embedded grammar's extraction (override without a
 * parse override). The registry table is ONE LINE per grammar; the dirs stay pure data, so the
 * custom-grammar seam and the embedded grammars are the same shape.
 *
 * Grammar dir shape: <lang>.wasm - the tree-sitter grammar (absent: shadow an embedded grammar)
 * <lang>.manifest.json - facts only: { "version": "0.23.2", "extensions": ["ts"] } queries.scm -
 * tree-sitter query patterns assigning jint captures (see query.ts)
 *
 * Validation: query compilation itself rejects unknown node types (loud, at load); capture names
 * are checked against the frozen vocabulary (see query.ts) — an .scm that captures outside the
 * vocabulary fails the run at setup, never parses into silence.
 */

import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Language, Parser, type Language as LanguageType } from "web-tree-sitter";
// The wasm engine itself, as a bundled asset: file path when running from source, embedded
// ($bunfs) path inside the compiled binary — Bun.file reads both, one loader serves both modes.
import treeSitterWasm from "web-tree-sitter/web-tree-sitter.wasm" with { type: "file" };
import { InternalError, SetupError } from "../types.ts";
import typescriptScm from "./embedded/typescript/queries.scm" with { type: "text" };
import typescriptManifest from "./embedded/typescript/typescript.manifest.json" with { type: "json" };
import typescriptWasm from "./embedded/typescript/typescript.wasm" with { type: "file" };

/** Which grammar served a parse: the embedded asset, or a user wasm by path and version. */
export type GrammarProvenance =
  | { readonly source: "embedded" }
  | { readonly source: "user"; readonly path: string; readonly version: string };

export interface GrammarEntry {
  readonly language: string;
  /** Extensions this grammar claims (leading dot normalized away). */
  readonly extensions: readonly string[];
  /** Bun.file-readable wasm path: a bundled asset path or an on-disk user path. */
  readonly wasmPath: string;
  /** The grammar's query patterns (the extraction half); compiled per language in query.ts. */
  readonly queries: string;
  readonly provenance: GrammarProvenance;
}

// ---------------------------------------------------------------------------
// Embedded grammars: compiled-in registrations through the user-facing shape.
// One line per grammar; each embedded/<lang>/ dir owns its data.
// ---------------------------------------------------------------------------

const EMBEDDED: Record<string, GrammarEntry> = {
  typescript: {
    language: "typescript",
    extensions: typescriptManifest.extensions,
    wasmPath: typescriptWasm,
    queries: typescriptScm,
    provenance: { source: "embedded" },
  },
};

// ---------------------------------------------------------------------------
// User grammars + merged view
// ---------------------------------------------------------------------------

/** User grammars registered by loadUserGrammars; null until the first lint start scanned the dir. */
let userGrammars: Record<string, GrammarEntry> | null = null;
let loadPromise: Promise<void> | null = null;

/** The grammar dir: $JINT_DIR/grammars (JINT_DIR precedent for moving roots off the homedir). */
export function grammarsDir(): string {
  return process.env.JINT_DIR !== undefined
    ? join(process.env.JINT_DIR, "grammars")
    : join(homedir(), ".jint", "grammars");
}

function entry(language: string): GrammarEntry {
  const user = userGrammars?.[language];
  return user ?? EMBEDDED[language]!;
}

/** All registered languages, embedded plus user (user registration replaces embedded by name). */
export function knownLanguages(): string[] {
  return [...new Set([...Object.keys(EMBEDDED), ...Object.keys(userGrammars ?? {})])];
}

function extensionToLanguage(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const language of knownLanguages()) {
    for (const extension of entry(language).extensions) map[extension] = language;
  }
  return map;
}

/** Canonical (first) extension per registered grammar — the "parsing" coverage note. */
export function grammarExtensions(): string[] {
  return knownLanguages().map((language) => entry(language).extensions[0]!);
}

/** The language for a path by registered extension, or null when no grammar claims it. */
export function languageOf(path: string): string | null {
  const match = path.match(/\.([A-Za-z0-9]+)$/);
  return match ? (extensionToLanguage()[match[1]!.toLowerCase()] ?? null) : null;
}

/**
 * The query source + provenance view the walker parses with; unknown language is an invariant
 * breach.
 */
export function grammar(language: string): GrammarEntry {
  if (!knownLanguages().includes(language)) {
    throw new InternalError(`no tree-sitter grammar registered for language: ${language}`);
  }
  return entry(language);
}

// ---------------------------------------------------------------------------
// Parser/engine (single init; parser per language, cached)
// ---------------------------------------------------------------------------

/** Parser instances are cached per language; web-tree-sitter itself initializes once. */
let initPromise: Promise<unknown> | null = null;
const parsers = new Map<string, Promise<Parser>>();
const languages = new Map<string, Promise<LanguageType>>();

// The wasm engine initializes once for every grammar; parsers are cached per language.
function engineReady(): Promise<unknown> {
  initPromise ??= Parser.init({
    // Bun quirk: Emscripten resolves the .wasm relative to the JS shim unless redirected.
    locateFile: () => treeSitterWasm,
  });
  return initPromise;
}

/** The loaded Language instance (parse, query compilation); cached per language. */
export function loadLanguage(language: string): Promise<LanguageType> {
  const cached = languages.get(language);
  if (cached) return cached;
  const created = (async () => {
    await engineReady();
    const { wasmPath } = grammar(language);
    return Language.load(new Uint8Array(await Bun.file(wasmPath).arrayBuffer()));
  })();
  languages.set(language, created);
  return created;
}

export async function parserFor(language: string): Promise<Parser> {
  const cached = parsers.get(language);
  if (cached) return cached;
  const created = loadLanguage(language).then((lang) => new Parser().setLanguage(lang));
  parsers.set(language, created);
  return created;
}

// ---------------------------------------------------------------------------
// The grammar-dir scan
// ---------------------------------------------------------------------------

interface Manifest {
  version: string;
  extensions: string[];
}

/** Facts only — the extraction half is the grammar's queries.scm. */
function readManifest(language: string, text: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SetupError(
      "CONFIG_INVALID",
      `invalid grammar manifest for ${language}: not valid JSON (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const { version, extensions } = raw as Partial<Manifest>;
  if (typeof version !== "string" || version.length === 0) {
    throw new SetupError(
      "CONFIG_INVALID",
      `invalid grammar manifest for ${language}: "version" (a pinned grammar version string) is required`,
    );
  }
  if (
    !Array.isArray(extensions) ||
    extensions.length === 0 ||
    extensions.some((x) => typeof x !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.]*$/.test(x))
  ) {
    throw new SetupError(
      "CONFIG_INVALID",
      `invalid grammar manifest for ${language} ${version}: "extensions" must be a non-empty array of file extensions`,
    );
  }
  return { version, extensions };
}

async function registerUserGrammar(language: string, dir: string): Promise<void> {
  const manifestPath = join(dir, `${language}.manifest.json`);
  const manifest = readManifest(language, await Bun.file(manifestPath).text());
  const wasmPath = join(dir, `${language}.wasm`);
  const hasWasm = await Bun.file(wasmPath).exists();
  const embeddedEntry = EMBEDDED[language];
  if (!hasWasm && embeddedEntry === undefined) {
    throw new SetupError(
      "CONFIG_INVALID",
      `grammar ${language} ${manifest.version}: no ${language}.wasm beside the manifest and no embedded grammar to shadow`,
    );
  }
  const queriesPath = join(dir, "queries.scm");
  if (!(await Bun.file(queriesPath).exists())) {
    throw new SetupError(
      "CONFIG_INVALID",
      `grammar ${language} ${manifest.version}: queries.scm is missing — a manifest carries facts only; the extraction patterns are the .scm`,
    );
  }
  const queries = await Bun.file(queriesPath).text();

  // The wasm that will serve parses (user when present, embedded shadow otherwise).
  const effectivePath = hasWasm ? wasmPath : embeddedEntry!.wasmPath;
  if (userGrammars?.[language] !== undefined) {
    // re-registration (a second lint start in-process): drop the cached parse state first
    languages.delete(language);
    parsers.delete(language);
  }
  userGrammars = {
    ...userGrammars,
    [language]: {
      language,
      extensions: manifest.extensions,
      wasmPath: effectivePath,
      queries,
      provenance: { source: "user", path: effectivePath, version: manifest.version },
    },
  };
}

/**
 * Lint-start scan: register every <lang>.manifest.json in the grammar dir. Idempotent; missing dir
 * scans as zero grammars (the embedded set alone). A malformed manifest, a missing queries.scm, or
 * an uncompilable .scm throws CONFIG_INVALID — loud, at setup, before any file is measured.
 */
export async function loadUserGrammars(dir: string = grammarsDir()): Promise<void> {
  loadPromise ??= (async () => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      // no grammar dir: embedded set only
      return;
    }
    for (const name of names) {
      const match = name.match(/^([A-Za-z0-9_-]+)\.manifest\.json$/);
      if (match) await registerUserGrammar(match[1]!, dir);
    }
  })();
  await loadPromise;
}

/** Test seam: reset registration state (cached parsers included) between scenarios. */
export function resetGrammarsForTest(): void {
  userGrammars = null;
  loadPromise = null;
  languages.clear();
  parsers.clear();
}
