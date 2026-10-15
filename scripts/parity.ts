/**
 * The parity harness: structural comparison of the query walker (this tree) against the previous
 * implementation (the embed-all worktree, run live — REFERENCE, never imported by the sdk).
 *
 * Bun scripts/parity.ts typescript [tsx go python css ...]
 *
 * For each language a corpus lives at tests/fixtures/parity/<lang>/corpus.<ext>. Both walkers
 * decompose it; elements compare on (noun, name, span). Differences are PRINTED, not asserted: the
 * harness is evidence, not a gate — a delta is either (a) documented (absorb widens spans,
 * member-chains/call-composites suppressed, names via @name) or (b) a regression to fix before the
 * grammar's port lands. Verdicts land in tests/fixtures/parity/<lang>/PARITY.md.
 *
 * EMBED_DIR overrides the reference worktree (default: sibling embed-all checkout).
 */

import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const REFERENCE = process.env.EMBED_DIR ?? join(ROOT, "..", "embed-all");

interface ComparedElement {
  noun: string;
  name?: string;
  span: string;
  content: string;
}

function spanKey(span: {
  start: { line: number; column: number };
  end: { line: number; column: number };
}): string {
  return `L${span.start.line}.${span.start.column}-L${span.end.line}.${span.end.column}`;
}

async function referenceElements(source: string, language: string): Promise<ComparedElement[]> {
  const reference = await import(join(REFERENCE, "packages/sdk/src/core/input/walk.ts"));
  const inventory = await reference.decompose(source, language);
  return [...inventory.definitions, ...inventory.comments, ...inventory.imports].map(
    (e: Record<string, unknown>) => ({
      noun: e.target !== undefined ? String(e.target) : String(e.role),
      name: e.name === undefined ? undefined : String(e.name),
      span: spanKey(e.span as never),
      content: String(e.content),
    }),
  );
}

async function queryElements(source: string, language: string): Promise<ComparedElement[]> {
  const { decompose } = await import(join(ROOT, "packages/sdk/src/core/input/walk.ts"));
  const inventory = await decompose(source, language);
  return [...inventory.definitions, ...inventory.comments, ...inventory.imports].map((e) => ({
    noun: e.capture,
    name: e.name,
    span: spanKey(e.span),
    content: e.content,
  }));
}

const CORPUS_EXT: Record<string, string> = {
  typescript: "ts",
  tsx: "tsx",
  python: "py",
  go: "go",
  css: "css",
  markdown: "md",
  c: "c",
  cpp: "cpp",
  php: "php",
  verilog: "sv",
};

function key(e: ComparedElement): string {
  return e.noun + " " + (e.name ?? "-") + " " + e.span;
}

function diff(what: string, reference: ComparedElement[], query: ComparedElement[]): void {
  console.log("\n== " + what);
  const queryKeys = new Set(query.map(key));
  const referenceKeys = new Set(reference.map(key));
  const onlyReference = reference.filter((e) => !queryKeys.has(key(e)));
  const onlyQuery = query.filter((e) => !referenceKeys.has(key(e)));
  for (const e of onlyReference)
    console.log("  REF-ONLY", e.noun, JSON.stringify(e.name), e.span, "|", firstLine(e.content));
  for (const e of onlyQuery)
    console.log("  NEW-ONLY", e.noun, JSON.stringify(e.name), e.span, "|", firstLine(e.content));
  if (onlyReference.length === 0 && onlyQuery.length === 0)
    console.log("  identical (" + reference.length + " elements)");
}

function firstLine(text: string): string {
  const line = text.split("\n")[0]!;
  return line.length > 70 ? line.slice(0, 70) + "..." : line;
}

for (const language of process.argv.slice(2)) {
  const corpusPath = join(
    ROOT,
    "tests/fixtures/parity",
    language,
    "corpus." + CORPUS_EXT[language],
  );
  const source = await Bun.file(corpusPath).text();
  const [reference, query] = await Promise.all([
    referenceElements(source, language),
    queryElements(source, language),
  ]);
  diff(language + " (reference " + relative(ROOT, REFERENCE) + ")", reference, query);
}
