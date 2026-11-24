import { BASE_MARKER, scmEmittedLines } from "./query.ts";
import type { GrammarRegistry } from "./grammars.ts";

/** What a walk did and did not capture in one file. */
export interface Coverage {
  readonly language: string;
  /** The captures of the queries that matched a node. */
  readonly matched: readonly string[];
  /** The types of the file's top nodes, when no element came out of it. */
  readonly uncaptured?: readonly string[];
}

/** Queries someone wrote: the ones worth a report on what they miss. */
interface OwnQueries {
  readonly label: string;
  readonly scm: string;
}

const counted = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

function emptyFileNote(paths: readonly string[], nodes: readonly string[]): string {
  const types = nodes.length === 0 ? "" : `: ${[...new Set(nodes)].join(", ")}`;
  const missed = `0 elements captured (${counted(nodes.length, "node")} not captured${types})`;
  return paths.length === 1
    ? `${paths[0]}: ${missed}`
    : `${paths.length} files: ${missed}: ${paths.join(", ")}`;
}

/** The notes on what a walk missed: files with no element, and captures that matched nothing. */
export class CoverageTally {
  private readonly empty = new Map<string, { paths: string[]; nodes: readonly string[] }>();
  private readonly files = new Map<string, number>();
  private readonly matched = new Map<string, Set<string>>();

  add(path: string, { language, matched, uncaptured }: Coverage): void {
    this.files.set(language, (this.files.get(language) ?? 0) + 1);
    const seen = this.matched.get(language) ?? new Set();
    this.matched.set(language, seen);
    for (const capture of matched) seen.add(capture);
    if (uncaptured === undefined) return;
    const key = [language, ...uncaptured].join(" ");
    const group = this.empty.get(key) ?? { paths: [], nodes: uncaptured };
    this.empty.set(key, group);
    group.paths.push(path);
  }

  notes(registry: GrammarRegistry, replacement?: OwnQueries): string[] {
    const notes = [...this.empty.values()].map((g) => emptyFileNote(g.paths, g.nodes));
    for (const [language, files] of this.files) {
      const own = replacement ?? ownQueriesOf(registry, language);
      if (own === undefined) continue;
      for (const [capture, line] of scmEmittedLines(own.scm.split(BASE_MARKER)[0]!)) {
        if (this.matched.get(language)!.has(capture)) continue;
        notes.push(`${own.label}:${line} @${capture} matched nothing in ${counted(files, "file")}`);
      }
    }
    return notes;
  }
}

/** An embedded grammar covers more than one project holds, so only a user's own is reported on. */
function ownQueriesOf(registry: GrammarRegistry, language: string): OwnQueries | undefined {
  const entry = registry[language];
  if (entry === undefined || entry.provenance.source !== "user") return undefined;
  return { label: `${language}/queries.scm`, scm: entry.queries };
}
