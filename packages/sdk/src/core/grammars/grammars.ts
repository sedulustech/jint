/**
 * The grammar registry: which languages exist, which wasm serves each parse, which .scm turns its
 * tree into elements. Embedded grammars are NOT special: each embedded/<id>/ directory carries the
 * same three artifacts a user grammar dir holds — <id>.wasm (parse), extensions.json (routing:
 * queries.scm (extraction + shape directives) — and registers through the same shape a user grammar
 * uses at runtime. A user grammar dir ($JINT_GRAMMAR_DIR, default ~/.jint/grammars) registers at
 * lint start: a user wasm wins over embedded for the same language, and a
 * queries.scm+extensions.json dir without a wasm shadows an embedded grammar (override without a
 * parse override). The registry table is ONE LINE per grammar; the dirs stay pure data, so the
 * custom-grammar seam and the embedded grammars are the same shape.
 *
 * Grammar dir shape: <lang>.wasm - the tree-sitter grammar (absent: shadow an embedded grammar)
 * extensions.json - facts only: [".ts"] - queries.scm - tree-sitter query patterns assigning jint
 * captures (see query.ts)
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
import cWasm from "./embedded/c/c.wasm" with { type: "file" };
import cExtensions from "./embedded/c/extensions.json" with { type: "json" };
import cScm from "./embedded/c/queries.scm" with { type: "text" };
import cppWasm from "./embedded/cpp/cpp.wasm" with { type: "file" };
import cppExtensions from "./embedded/cpp/extensions.json" with { type: "json" };
import cppScm from "./embedded/cpp/queries.scm" with { type: "text" };
import cssWasm from "./embedded/css/css.wasm" with { type: "file" };
import cssExtensions from "./embedded/css/extensions.json" with { type: "json" };
import cssScm from "./embedded/css/queries.scm" with { type: "text" };
import goExtensions from "./embedded/go/extensions.json" with { type: "json" };
import goWasm from "./embedded/go/go.wasm" with { type: "file" };
import goScm from "./embedded/go/queries.scm" with { type: "text" };
import markdownExtensions from "./embedded/markdown/extensions.json" with { type: "json" };
import markdownWasm from "./embedded/markdown/markdown.wasm" with { type: "file" };
import markdownScm from "./embedded/markdown/queries.scm" with { type: "text" };
import phpExtensions from "./embedded/php/extensions.json" with { type: "json" };
import phpWasm from "./embedded/php/php.wasm" with { type: "file" };
import phpScm from "./embedded/php/queries.scm" with { type: "text" };
import pythonExtensions from "./embedded/python/extensions.json" with { type: "json" };
import pythonWasm from "./embedded/python/python.wasm" with { type: "file" };
import pythonScm from "./embedded/python/queries.scm" with { type: "text" };
import tsxExtensions from "./embedded/tsx/extensions.json" with { type: "json" };
import tsxScm from "./embedded/tsx/queries.scm" with { type: "text" };
import tsxWasm from "./embedded/tsx/tsx.wasm" with { type: "file" };
import typescriptExtensions from "./embedded/typescript/extensions.json" with { type: "json" };
import typescriptScm from "./embedded/typescript/queries.scm" with { type: "text" };
import typescriptWasm from "./embedded/typescript/typescript.wasm" with { type: "file" };

/** Which grammar served a parse: the embedded asset, or a user wasm by path. */
export type GrammarProvenance =
  | { readonly source: "embedded" }
  | { readonly source: "user"; readonly path: string };

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
    extensions: typescriptExtensions,
    wasmPath: typescriptWasm,
    queries: typescriptScm,
    provenance: { source: "embedded" },
  },
  tsx: {
    language: "tsx",
    extensions: tsxExtensions,
    wasmPath: tsxWasm,
    queries: tsxScm,
    provenance: { source: "embedded" },
  },
  python: {
    language: "python",
    extensions: pythonExtensions,
    wasmPath: pythonWasm,
    queries: pythonScm,
    provenance: { source: "embedded" },
  },
  markdown: {
    language: "markdown",
    extensions: markdownExtensions,
    wasmPath: markdownWasm,
    queries: markdownScm,
    provenance: { source: "embedded" },
  },
  php: {
    language: "php",
    extensions: phpExtensions,
    wasmPath: phpWasm,
    queries: phpScm,
    provenance: { source: "embedded" },
  },
  go: {
    language: "go",
    extensions: goExtensions,
    wasmPath: goWasm,
    queries: goScm,
    provenance: { source: "embedded" },
  },
  cpp: {
    language: "cpp",
    extensions: cppExtensions,
    wasmPath: cppWasm,
    queries: cppScm,
    provenance: { source: "embedded" },
  },
  c: {
    language: "c",
    extensions: cExtensions,
    wasmPath: cWasm,
    queries: cScm,
    provenance: { source: "embedded" },
  },
  css: {
    language: "css",
    extensions: cssExtensions,
    wasmPath: cssWasm,
    queries: cssScm,
    provenance: { source: "embedded" },
  },
};

// ---------------------------------------------------------------------------
// User grammars + merged view
// ---------------------------------------------------------------------------

/** User grammars registered by loadUserGrammars; null until the first lint start scanned the dir. */
let userGrammars: Record<string, GrammarEntry> | null = null;
let loadPromise: Promise<void> | null = null;

/**
 * The grammar dir: $JINT_GRAMMAR_DIR, else <homedir>/.jint/grammars — ONE var, one root, no
 * precedence chain. (Deliberation note: a future container one-knob would be a JINT_HOME base the
 * specific vars default FROM, specific always wins — never an umbrella tier.)
 */
export function grammarsDir(): string {
  return process.env.JINT_GRAMMAR_DIR !== undefined
    ? process.env.JINT_GRAMMAR_DIR
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

/**
 * Every registered extension, in registration order — the "parsing" coverage note lists the ACTUAL
 * claim surface (c also parses .h, so the note says c, h, not just c).
 */
export function grammarExtensions(): string[] {
  return [...new Set(knownLanguages().flatMap((language) => [...entry(language).extensions]))].map(
    (e) => e.replace(/^\./, ""),
  );
}

/**
 * Extension -> language routing. Collisions resolve by REGISTRATION ORDER, first wins, and the
 * registry lists files in the order the embedded table declares them - cpp precedes c, so .h routes
 * to cpp today. That is a policy choice, not a fact of the languages: it is recorded in the design
 * doc's open questions (grammar-loading: extension conflicts are silent-wins).
 */
function extensionToLanguage(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const language of knownLanguages()) {
    for (const extension of entry(language).extensions) {
      map[extension.replace(/^\./, "")] ??= language;
    }
  }
  return map;
}

/** The language for a path by registered extension, or null when no grammar claims it. */
export function languageOf(path: string): string | null {
  const match = path.match(/\.([A-Za-z0-9]+)$/);
  return match ? (extensionToLanguage()[match[1]!.toLowerCase()] ?? null) : null;
}

/**
 * The sweep-coverage token for one path no grammar claims: its extension, "(extensionless)". SHARED
 * by lint() (its one coverage note) and capture() (its per-file onSkip events).
 */
export function unclaimedExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "(extensionless)" : path.slice(dot);
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

/**
 * The grammar's DECLARED routing: extensions.json, a bare JSON array of dot-prefixed extensions
 * (e.g. [".md"]). One fact per artifact; invalid shapes fail loud at registration.
 */
function readExtensions(grammarId: string, text: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SetupError(
      "CONFIG_INVALID",
      `invalid extensions.json for grammar ${grammarId}: not valid JSON (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.some((x) => typeof x !== "string" || !/^\.[A-Za-z0-9][A-Za-z0-9.]*$/.test(x))
  ) {
    throw new SetupError(
      "CONFIG_INVALID",
      `invalid extensions.json for grammar ${grammarId}: must be a non-empty array of dot-prefixed extensions (e.g. [".md"])`,
    );
  }
  // lowercased HERE, not at routing: ".TS" must not register a key languageOf (which lowercases
  // paths) can never hit - a silently unroutable extension is the failure shape we refuse
  return (raw as string[]).map((x) => x.slice(1).toLowerCase());
}

/**
 * THE COPY-PASTE GUARD: the wasm's exported tree-sitter language function names its language; the
 * directory names the grammar id. A mismatch (a copied wasm under the wrong dir) is a loud
 * CONFIG_INVALID naming both - the id is owned by the directory and cross-checked against the
 * wasm's own export, never taken on faith.
 */
export async function assertWasmMatchesDir(grammarId: string, wasmPath: string): Promise<void> {
  let mod: WebAssembly.Module;
  try {
    mod = await WebAssembly.compile(new Uint8Array(await Bun.file(wasmPath).arrayBuffer()));
  } catch {
    throw new SetupError(
      "CONFIG_INVALID",
      `grammar ${grammarId}: ${wasmPath} is not a valid wasm module - the wasm must be a tree-sitter grammar whose export is tree_sitter_${grammarId}`,
    );
  }
  // EXACT lookup, never first-match: multi-export wasms (tree-sitter-typescript ships tsx AND
  // typescript functions) make .find() order-dependent - the dir asks for one specific language.
  const expected = "tree_sitter_" + grammarId;
  const exported = WebAssembly.Module.exports(mod).map((e) => e.name);
  const found = exported.filter((n) => /^tree_sitter_[A-Za-z0-9_]+$/.test(n));
  if (!exported.includes(expected)) {
    throw new SetupError(
      "CONFIG_INVALID",
      `grammar dir "${grammarId}" holds a wasm that does not export "${expected}"` +
        (found.length > 0
          ? ` (it exports: ${found.join(", ")}) - the directory name and the wasm disagree (a copy-paste?); rename the dir or ship the right wasm`
          : ` - not a tree-sitter grammar wasm`),
    );
  }
}

async function registerUserGrammar(
  grammarId: string,
  dir: string,
  options: { readonly queriesOptional?: boolean } = {},
): Promise<void> {
  const queriesPath = join(dir, "queries.scm");
  if (!(await Bun.file(queriesPath).exists()) && options.queriesOptional !== true) {
    throw new SetupError(
      "CONFIG_INVALID",
      `grammar ${grammarId}: queries.scm is missing - the .scm is the extraction half and the grammar's interface; there is no manifest to carry facts`,
    );
  }
  const extensionsPath = join(dir, "extensions.json");
  if (!(await Bun.file(extensionsPath).exists())) {
    throw new SetupError(
      "CONFIG_INVALID",
      `grammar ${grammarId}: extensions.json is missing - routing is a bare JSON array of dot-prefixed extensions (e.g. [".md"])`,
    );
  }
  const extensions = readExtensions(grammarId, await Bun.file(extensionsPath).text());
  // queriesOptional = an explicit .scm override supplies extraction for THIS call; the dir's own
  // queries.scm - present or not - is NOT read (it would be unused, and reading it unvalidated
  // would license a bad .scm through the side door). The registry entry carries the empty marker;
  // the walker turns any OVERRIDE-LESS use of that marker into a LOUD error - never silent zero.
  const queries =
    options.queriesOptional !== true && (await Bun.file(queriesPath).exists())
      ? await Bun.file(queriesPath).text()
      : "";
  const wasmPath = join(dir, `${grammarId}.wasm`);
  const hasWasm = await Bun.file(wasmPath).exists();
  const embeddedEntry = EMBEDDED[grammarId];
  if (!hasWasm && embeddedEntry === undefined) {
    throw new SetupError(
      "CONFIG_INVALID",
      `grammar ${grammarId}: no ${grammarId}.wasm in the dir and no embedded grammar of that name to shadow`,
    );
  }
  // The wasm that will actually serve parses: the user's when present, else the shadowed
  // embedded asset. Either way the export must agree with the directory name.
  const servingWasmPath = hasWasm ? wasmPath : embeddedEntry!.wasmPath;
  await assertWasmMatchesDir(grammarId, servingWasmPath);
  if (userGrammars?.[grammarId] !== undefined) {
    // re-registration (a second lint start in-process): drop the cached parse state first
    languages.delete(grammarId);
    parsers.delete(grammarId);
  }
  userGrammars = {
    ...userGrammars,
    [grammarId]: {
      language: grammarId,
      extensions,
      wasmPath: servingWasmPath,
      queries,
      provenance: { source: "user", path: servingWasmPath },
    },
  };
}

/**
 * Lint-start scan: register the grammars under the grammar dir. THE SEAM IS ONE GRAMMAR PER DIR:
 * each SUBDIRECTORY is one grammar, its id the DIRECTORY NAME (nextjs-route semantics); a stray
 * file at the root is a coverage note (stale artifact of the flat layout - artifacts are flat
 * INSIDE a grammar dir, never at the root). Missing dir scans as zero grammars (the embedded set
 * alone). A missing artifact, a malformed extensions.json, an uncompilable .scm, or a wasm whose
 * export disagrees with the dir name throws CONFIG_INVALID - loud, at setup, before any file is
 * measured.
 */
export async function loadUserGrammars(
  dir: string = grammarsDir(),
  onNote?: (note: string) => void,
): Promise<void> {
  loadPromise ??= (async () => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      // No grammar dir is the common case: the embedded set alone needs no note. A dir that
      // exists but cannot be read is not absence - say so, because the run silently loses it.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        onNote?.(`grammar dir ${dir}: unreadable (${(err as Error).message}) - embedded set only`);
      }
      return;
    }
    const strayFiles = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
    if (strayFiles.length > 0 && onNote !== undefined) {
      onNote(
        `grammar dir ${dir}: ${strayFiles.length} loose file(s) (${strayFiles.join()}) ignored - each grammar is one directory named for its id`,
      );
    }
    for (const entry of entries) {
      if (entry.isDirectory() && /^[A-Za-z0-9_-]+$/.test(entry.name)) {
        await registerUserGrammar(entry.name, join(dir, entry.name));
      }
    }
  })();
  await loadPromise;
}
/**
 * Custom registration for ONE capture() call: a grammar DIRECTORY (wasm + extensions.json [+
 * queries.scm]) registered under its directory name with every BYOG loud validation - wasm
 * cross-check, extensions.json routing, .scm compile when present. Nothing is installed: the
 * registry is process-local memory, exactly what a JINT_GRAMMAR_DIR scan produces.
 */
export async function registerCustomGrammar(
  dir: string,
  options: { readonly queriesOptional?: boolean } = {},
): Promise<void> {
  const id = dir.split(/[\\/]/).filter(Boolean).pop();
  if (id !== undefined && /[A-Z]/.test(id)) {
    throw new SetupError(
      "CONFIG_INVALID",
      `grammar ids are lowercase - rename the dir ${id} -> ${id.toLowerCase()}`,
    );
  }
  if (id === undefined || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new SetupError(
      "CONFIG_INVALID",
      "grammar dir " + dir + ": the directory name is the grammar id",
    );
  }
  await registerUserGrammar(id, dir, options);
}
/** Test seam: reset registration state (cached parsers included) between scenarios. */
export function resetGrammarsForTest(): void {
  userGrammars = null;
  loadPromise = null;
  languages.clear();
  parsers.clear();
}
