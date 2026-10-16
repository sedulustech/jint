/**
 * The grammar registry: which languages exist, which wasm serves each parse, which .scm turns its
 * tree into elements. Embedded grammars are NOT special: each embedded/<lang>/ directory carries
 * the same three artifacts a user grammar dir holds — <lang>.wasm (parse), <lang>.manifest.json
 * (facts: version, extensions), queries.scm (extraction patterns) — and registers through the same
 * shape a user grammar uses at runtime. A user grammar dir ($JINT_GRAMMAR_DIR, default
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
import cManifest from "./embedded/c/c.manifest.json" with { type: "json" };
import cWasm from "./embedded/c/c.wasm" with { type: "file" };
import cScm from "./embedded/c/queries.scm" with { type: "text" };
import cppManifest from "./embedded/cpp/cpp.manifest.json" with { type: "json" };
import cppWasm from "./embedded/cpp/cpp.wasm" with { type: "file" };
import cppScm from "./embedded/cpp/queries.scm" with { type: "text" };
import cssManifest from "./embedded/css/css.manifest.json" with { type: "json" };
import cssWasm from "./embedded/css/css.wasm" with { type: "file" };
import cssScm from "./embedded/css/queries.scm" with { type: "text" };
import goManifest from "./embedded/go/go.manifest.json" with { type: "json" };
import goWasm from "./embedded/go/go.wasm" with { type: "file" };
import goScm from "./embedded/go/queries.scm" with { type: "text" };
import markdownManifest from "./embedded/markdown/markdown.manifest.json" with { type: "json" };
import markdownWasm from "./embedded/markdown/markdown.wasm" with { type: "file" };
import markdownScm from "./embedded/markdown/queries.scm" with { type: "text" };
import phpManifest from "./embedded/php/php.manifest.json" with { type: "json" };
import phpWasm from "./embedded/php/php.wasm" with { type: "file" };
import phpScm from "./embedded/php/queries.scm" with { type: "text" };
import pythonManifest from "./embedded/python/python.manifest.json" with { type: "json" };
import pythonWasm from "./embedded/python/python.wasm" with { type: "file" };
import pythonScm from "./embedded/python/queries.scm" with { type: "text" };
import tsxScm from "./embedded/tsx/queries.scm" with { type: "text" };
import tsxManifest from "./embedded/tsx/tsx.manifest.json" with { type: "json" };
import tsxWasm from "./embedded/tsx/tsx.wasm" with { type: "file" };
import typescriptScm from "./embedded/typescript/queries.scm" with { type: "text" };
import typescriptManifest from "./embedded/typescript/typescript.manifest.json" with { type: "json" };
import typescriptWasm from "./embedded/typescript/typescript.wasm" with { type: "file" };
import { ELEMENT_CAPTURES } from "./query.ts";

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
  /**
   * Per-grammar policy overrides over the capture table in query.ts (keys: captures or
   * "selfNesting"; absent keys keep the table defaults - simple grammars stay zero-config).
   */
  readonly policy?: Record<string, unknown>;
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
  tsx: {
    language: "tsx",
    extensions: tsxManifest.extensions,
    wasmPath: tsxWasm,
    queries: tsxScm,
    provenance: { source: "embedded" },
  },
  python: {
    language: "python",
    extensions: pythonManifest.extensions,
    wasmPath: pythonWasm,
    queries: pythonScm,
    provenance: { source: "embedded" },
  },
  markdown: {
    language: "markdown",
    extensions: markdownManifest.extensions,
    wasmPath: markdownWasm,
    queries: markdownScm,
    policy: markdownManifest.policy,
    provenance: { source: "embedded" },
  },
  php: {
    language: "php",
    extensions: phpManifest.extensions,
    wasmPath: phpWasm,
    queries: phpScm,
    provenance: { source: "embedded" },
  },
  go: {
    language: "go",
    extensions: goManifest.extensions,
    wasmPath: goWasm,
    queries: goScm,
    provenance: { source: "embedded" },
  },
  cpp: {
    language: "cpp",
    extensions: cppManifest.extensions,
    wasmPath: cppWasm,
    queries: cppScm,
    provenance: { source: "embedded" },
  },
  c: {
    language: "c",
    extensions: cManifest.extensions,
    wasmPath: cWasm,
    queries: cScm,
    provenance: { source: "embedded" },
  },
  css: {
    language: "css",
    extensions: cssManifest.extensions,
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
  return [...new Set(knownLanguages().flatMap((language) => [...entry(language).extensions]))];
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
      map[extension] ??= language;
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
 * Validated manifest policy: keys are captures or "selfNesting"; a capture's value carries opaque /
 * absorbTail; unknown keys or shapes are loud config errors (an override that can never fire must
 * not parse into silence).
 */
function manifestPolicy(
  language: string,
  version: string,
  raw: unknown,
): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SetupError(
      "CONFIG_INVALID",
      `invalid grammar manifest for ${language} ${version}: "policy" must be an object keyed by capture or "selfNesting"`,
    );
  }
  const captures = new Set<string>(ELEMENT_CAPTURES);
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "selfNesting") {
      if (typeof value !== "boolean") {
        throw new SetupError(
          "CONFIG_INVALID",
          `invalid grammar manifest for ${language} ${version}: policy.selfNesting must be a boolean`,
        );
      }
      continue;
    }
    // an unknown key is a typo that would sit inert forever: reject it by name, with the list
    if (!captures.has(key)) {
      throw new SetupError(
        "CONFIG_INVALID",
        `invalid grammar manifest for ${language} ${version}: policy.${key} names no capture (captures: ${[...captures].join(", ")}, or "selfNesting")`,
      );
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new SetupError(
        "CONFIG_INVALID",
        `invalid grammar manifest for ${language} ${version}: policy.${key} must be { opaque?: boolean, absorbTail?: non-negative integer }`,
      );
    }
    const entry = value as { opaque?: unknown; absorbTail?: unknown };
    for (const field of Object.keys(entry)) {
      if (field !== "opaque" && field !== "absorbTail") {
        throw new SetupError(
          "CONFIG_INVALID",
          `invalid grammar manifest for ${language} ${version}: policy.${key}.${field} is not a policy field (opaque, absorbTail)`,
        );
      }
    }
    if (entry.opaque !== undefined && typeof entry.opaque !== "boolean") {
      throw new SetupError(
        "CONFIG_INVALID",
        `invalid grammar manifest for ${language} ${version}: policy.${key}.opaque must be a boolean`,
      );
    }
    if (
      entry.absorbTail !== undefined &&
      (typeof entry.absorbTail !== "number" ||
        !Number.isInteger(entry.absorbTail) ||
        entry.absorbTail < 0)
    ) {
      throw new SetupError(
        "CONFIG_INVALID",
        `invalid grammar manifest for ${language} ${version}: policy.${key}.absorbTail must be a non-negative integer (got ${String(entry.absorbTail)})`,
      );
    }
  }
  return raw as Record<string, unknown>;
}

interface Manifest {
  version: string;
  extensions: string[];
  policy?: Record<string, unknown>;
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
  return {
    version,
    extensions,
    policy: manifestPolicy(language, version, (raw as { policy?: unknown }).policy),
  };
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
      policy: manifest.policy,
      provenance: { source: "user", path: effectivePath, version: manifest.version },
    },
  };
}

/**
 * Lint-start scan: register the grammars in ONE flat grammar dir. THE SEAM IS ONE GRAMMAR PER DIR,
 * ARTIFACTS FLAT: two manifests would share the one queries.scm filename (the second language would
 * extract with the first's patterns, silently wrong) - that is a setup error naming the dir and the
 * rule. Subdirectories are ignored, as one coverage note (artifacts sit flat; a nested grammar dir
 * is invisible, and signal beats silence). Missing dir scans as zero grammars (the embedded set
 * alone). A malformed manifest, a missing queries.scm, or an uncompilable .scm throws
 * CONFIG_INVALID — loud, at setup, before any file is measured.
 */
export async function loadUserGrammars(
  dir: string = grammarsDir(),
  onNote?: (note: string) => void,
): Promise<void> {
  loadPromise ??= (async () => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // no grammar dir: embedded set only
      return;
    }
    const manifests = entries
      .filter((entry) => /^([A-Za-z0-9_-]+)\.manifest\.json$/.test(entry.name))
      .map((entry) => entry.name);
    if (manifests.length > 1) {
      throw new SetupError(
        "CONFIG_INVALID",
        `grammar dir ${dir}: ${manifests.length} manifests (${manifests.join(", ")}) - one grammar per dir: the artifacts sit flat and share one queries.scm, so a second manifest would extract with the first's patterns`,
      );
    }
    if (onNote !== undefined && entries.some((entry) => entry.isDirectory())) {
      onNote(`grammar dir ${dir}: subdirs are ignored - artifacts sit flat (one grammar per dir)`);
    }
    for (const name of manifests) {
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
