/**
 * The grammar registry: which languages exist, which wasm serves each parse, which .scm turns its
 * tree into elements. Embedded grammars are NOT special: each embedded/<id>/ directory carries the
 * same three artifacts a custom grammar dir holds — <id>.wasm (parse), extensions.json (routing:
 * queries.scm (extraction + shape directives) — and registers through the same shape a custom
 * grammar uses at runtime. The registry is a VALUE, not a table: every scope builds one per run or
 * call (the embedded base merged with whatever customs that scope sees) and threads it explicitly
 * through walk/query entry points — no module-level mutable state, so a custom registration can
 * never outlive the call that asked for it. A custom grammar dir ($JINT_GRAMMAR_DIR, default
 * ~/.jint/grammars) merges at lint start: a custom wasm wins over embedded for the same language,
 * and a queries.scm+extensions.json dir without a wasm shadows an embedded grammar (override
 * without a parse override). The registry is one line per grammar; the dirs stay pure data, so the
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

/**
 * A registry VALUE: the embedded base overlaid with custom grammars, one entry per language id.
 * Built per run (lint) or per call (capture); never stored at module scope — the value dying with
 * its run is what makes custom registration side-effect-free.
 */
export type GrammarRegistry = Readonly<Record<string, GrammarEntry>>;

// ---------------------------------------------------------------------------
// Embedded grammars: compiled-in registrations through the custom-facing shape.
// One line per grammar; each embedded/<lang>/ dir owns its data. Static data: the immutable base
// every registry value starts from, and the default when a scope has no custom grammars.
// ---------------------------------------------------------------------------

export const EMBEDDED: GrammarRegistry = {
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
// Registry reads (every read takes the registry value it reads from)
// ---------------------------------------------------------------------------

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

/**
 * All languages a registry holds. The default is the embedded base — the static answer a caller
 * with no run in hand means (the CLI's --language gate, schema generation); run code passes the
 * registry it built.
 */
export function knownLanguages(registry: GrammarRegistry = EMBEDDED): string[] {
  return Object.keys(registry);
}

/**
 * Every registered extension, in registration order — the "parsing" coverage note lists the ACTUAL
 * claim surface (c also parses .h, so the note says c, h, not just c).
 */
export function grammarExtensions(registry: GrammarRegistry): string[] {
  return [...new Set(knownLanguages(registry).flatMap((l) => [...registry[l]!.extensions]))].map(
    (e) => e.replace(/^\./, ""),
  );
}

/**
 * Extension -> language routing. Collisions resolve by REGISTRATION ORDER, first wins, and the
 * registry lists files in the order the embedded table declares them - cpp precedes c, so .h routes
 * to cpp today. That is a policy choice, not a fact of the languages: it is recorded in the design
 * doc's open questions (grammar-loading: extension conflicts are silent-wins).
 */
function extensionToLanguage(registry: GrammarRegistry): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [language, entry] of Object.entries(registry)) {
    for (const extension of entry.extensions) {
      map[extension.replace(/^\./, "")] ??= language;
    }
  }
  return map;
}

/** The language for a path by the registry's registered extensions, or null when none claims it. */
export function languageOf(registry: GrammarRegistry, path: string): string | null {
  const match = path.match(/\.([A-Za-z0-9]+)$/);
  return match ? (extensionToLanguage(registry)[match[1]!.toLowerCase()] ?? null) : null;
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
 * The query source + provenance view the walker parses with; unknown language in the registry at
 * hand is an invariant breach.
 */
export function grammar(registry: GrammarRegistry, language: string): GrammarEntry {
  const found = registry[language];
  if (found === undefined) {
    throw new InternalError(`no tree-sitter grammar registered for language: ${language}`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Parser/engine (single init; parser per wasm, memoized)
// ---------------------------------------------------------------------------

/**
 * Parser instances are memoized per SERVING WASM (the wasm a registry entry names); web-tree-sitter
 * itself initializes once. Keyed by wasmPath, never by language id: two registry values may serve
 * different wasms under one id (a custom grammar overriding an embedded one), and each holds its
 * own parse state. Pure memo - invisible to behavior; a path's content is stable within a process
 * (grammar dirs are static artifacts).
 */
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

/** The loaded Language instance (parse, query compilation); memoized per serving wasm. */
export function loadLanguage(entry: GrammarEntry): Promise<LanguageType> {
  const cached = languages.get(entry.wasmPath);
  if (cached) return cached;
  const created = (async () => {
    await engineReady();
    return Language.load(new Uint8Array(await Bun.file(entry.wasmPath).arrayBuffer()));
  })();
  languages.set(entry.wasmPath, created);
  return created;
}

export function parserFor(entry: GrammarEntry): Promise<Parser> {
  const cached = parsers.get(entry.wasmPath);
  if (cached) return cached;
  const created = loadLanguage(entry).then((lang) => new Parser().setLanguage(lang));
  parsers.set(entry.wasmPath, created);
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

/**
 * Read one custom grammar dir into a VALIDATED registry entry; loud on every artifact failure.
 * Returns the entry - the caller composes its registry value; nothing is stored, nothing global is
 * touched.
 */
async function readCustomGrammar(
  grammarId: string,
  dir: string,
  options: { readonly queriesOptional?: boolean } = {},
): Promise<GrammarEntry> {
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
  // would license a bad .scm through the side path). The entry carries the empty marker; that
  // marker can never be walked override-less, because the entry lives only in the registry value
  // the call holding the override builds - the unwind is by construction (2026-10-19: the interim
  // walker guard for the marker died with the mutable global it papered over).
  let queries = "";
  if (options.queriesOptional !== true && (await Bun.file(queriesPath).exists())) {
    queries = await Bun.file(queriesPath).text();
    // an EMPTY .scm compiles clean and extracts nothing - the worst failure shape there is. Loud
    // HERE, at the artifact read, where the dir's other artifact validations live.
    if (queries.trim() === "") {
      throw new SetupError(
        "CONFIG_INVALID",
        `grammar ${grammarId}: queries.scm is empty - it is the extraction half; an empty one compiles clean and extracts nothing`,
      );
    }
  }
  const wasmPath = join(dir, `${grammarId}.wasm`);
  const hasWasm = await Bun.file(wasmPath).exists();
  const embeddedEntry = EMBEDDED[grammarId];
  if (!hasWasm && embeddedEntry === undefined) {
    throw new SetupError(
      "CONFIG_INVALID",
      `grammar ${grammarId}: no ${grammarId}.wasm in the dir and no embedded grammar of that name to shadow`,
    );
  }
  // The wasm that will actually serve parses: the custom's when present, else the shadowed
  // embedded asset. Either way the export must agree with the directory name.
  const servingWasmPath = hasWasm ? wasmPath : embeddedEntry!.wasmPath;
  await assertWasmMatchesDir(grammarId, servingWasmPath);
  return {
    language: grammarId,
    extensions,
    wasmPath: servingWasmPath,
    queries,
    provenance: { source: "user", path: servingWasmPath },
  };
}

/**
 * The grammar-dir scan, returned as a REGISTRY VALUE: the custom grammars under the dir merged over
 * the embedded base. THE SEAM IS ONE GRAMMAR PER DIR: each SUBDIRECTORY is one grammar, its id the
 * DIRECTORY NAME (nextjs-route semantics); a stray file at the root is a coverage note (stale
 * artifact of the flat layout - artifacts are flat INSIDE a grammar dir, never at the root).
 * Missing dir scans as zero grammars (the embedded base alone). A missing artifact, a malformed
 * extensions.json, an empty or uncompilable .scm, or a wasm whose export disagrees with the dir
 * name throws CONFIG_INVALID - loud, at setup, before any file is measured. The caller owns the
 * value's lifetime: it lives and dies with the run or call that asked for it.
 */
export async function loadCustomGrammars(
  dir: string = grammarsDir(),
  onNote?: (note: string) => void,
): Promise<GrammarRegistry> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    // No grammar dir is the common case: the embedded base alone needs no note. A dir that
    // exists but cannot be read is not absence - say so, because the run silently loses it.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      onNote?.(`grammar dir ${dir}: unreadable (${(err as Error).message}) - embedded set only`);
    }
    return EMBEDDED;
  }
  const strayFiles = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
  if (strayFiles.length > 0 && onNote !== undefined) {
    onNote(
      `grammar dir ${dir}: ${strayFiles.length} loose file(s) (${strayFiles.join()}) ignored - each grammar is one directory named for its id`,
    );
  }
  const customs: Record<string, GrammarEntry> = {};
  for (const entry of entries) {
    if (entry.isDirectory() && /^[A-Za-z0-9_-]+$/.test(entry.name)) {
      customs[entry.name] = await readCustomGrammar(entry.name, join(dir, entry.name));
    }
  }
  return { ...EMBEDDED, ...customs };
}
/**
 * ONE capture() call's custom registration: a grammar DIRECTORY (wasm + extensions.json [+
 * queries.scm]) read under its directory name with every BYOG loud validation - wasm cross-check,
 * extensions.json routing, .scm compile when present. Returns the entry for the CALL's registry
 * value; nothing is installed and no global state exists to install into - the registration IS the
 * returned value, exactly what a JINT_GRAMMAR_DIR scan reads per grammar.
 */
export async function registerCustomGrammar(
  dir: string,
  options: { readonly queriesOptional?: boolean } = {},
): Promise<GrammarEntry> {
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
  return readCustomGrammar(id, dir, options);
}
