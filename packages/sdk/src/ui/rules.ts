/**
 * The rules view's read model: every rule of the repo's config with how it behaved in the stored
 * runs. Definitions come from the latest run's config when it still loads (that is the only place a
 * rule that never ran exists) and from the run reports otherwise; history comes from the reports
 * alone. A run is immutable once its report is written, so each report is read once.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isChoiceHandler, isScoreHandler, type HandlerData } from "@jint/contract";
import { loadConfig } from "../config/load.ts";
import { collectRunCandidates, readStoredReport } from "./api.ts";

export type RuleKind = "noul" | "choice" | "score";

/** Counts, never rates: a run of one file must not look like a run of fifty. */
export interface RuleRun {
  id: string;
  n: number;
  fired: number;
  cached: number;
}

export interface RuleView {
  name: string;
  kind: RuleKind;
  instructions?: string;
  criteria: unknown;
  handle: HandlerData | null;
  /** Oldest to newest, at most HISTORY runs. */
  runs: RuleRun[];
}

/** Runs read per request, newest first: enough for the sparkline, bounded on a big store. */
const SCAN = 200;
const HISTORY = 14;

interface Digest {
  name: string;
  instructions?: string;
  criteria: unknown;
  handle: HandlerData | null;
}

const kindFromHandle = (handle: HandlerData | null): RuleKind | null => {
  if (handle === null) return null;
  if (isScoreHandler(handle)) return "score";
  return isChoiceHandler(handle) ? "choice" : null;
};

const hasTrueFalseCriteria = (criteria: unknown): boolean =>
  typeof criteria === "object" && criteria !== null && "true" in criteria;

const kindOf = (digest: Digest): RuleKind | null =>
  kindFromHandle(digest.handle) ?? (hasTrueFalseCriteria(digest.criteria) ? "noul" : null);

interface Summary {
  byRule: Map<string, RuleRun>;
  digests: Digest[];
}

const isMissingFile = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT";

const runSummaries = new Map<string, Summary>();

async function readReport(id: string, dir: string): Promise<Record<string, unknown> | null> {
  try {
    return await readStoredReport(dir);
  } catch (err) {
    // a run in flight has no report yet, so it is read again next time; any other failure is real
    if (isMissingFile(err)) return null;
    throw new Error(`cannot read the report of run ${id}`, { cause: err });
  }
}

function tally(id: string, report: Record<string, unknown>): Summary {
  const byRule = new Map<string, RuleRun>();
  const entry = (rule: string): RuleRun => {
    let run = byRule.get(rule);
    if (run === undefined) byRule.set(rule, (run = { id, n: 0, fired: 0, cached: 0 }));
    return run;
  };
  const classifications = (report.classifications ?? []) as {
    rule: string;
    value?: number;
    cached?: boolean;
  }[];
  for (const classification of classifications) {
    if (classification.value === undefined) continue;
    const run = entry(classification.rule);
    run.n += 1;
    if (classification.cached === true) run.cached += 1;
  }
  for (const finding of (report.findings ?? []) as { rule: string }[])
    entry(finding.rule).fired += 1;
  return { byRule, digests: (report.rules ?? []) as Digest[] };
}

async function summarize(id: string, dir: string): Promise<Summary | null> {
  const known = runSummaries.get(id);
  if (known !== undefined) return known;
  const report = await readReport(id, dir);
  if (report === null) return null;
  const summary = tally(id, report);
  runSummaries.set(id, summary);
  return summary;
}

async function configPathOf(dir: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as {
      configPath?: string | null;
    };
    return manifest.configPath ?? null;
  } catch (err) {
    if (isMissingFile(err)) return null;
    throw new Error(`cannot read the manifest of ${dir}`, { cause: err });
  }
}

interface Loaded {
  defs: Map<string, Digest>;
  configPath: string | null;
  configFailure: Error | undefined;
}

type ConfigTry = { defs: Map<string, Digest> } | { failure: Error };

async function tryConfig(path: string): Promise<ConfigTry> {
  try {
    const config = await loadConfig(path);
    const defs = new Map<string, Digest>();
    for (const rule of config.rules) {
      defs.set(rule.name, {
        name: rule.name,
        instructions: "instructions" in rule ? rule.instructions : undefined,
        criteria: "criteria" in rule ? rule.criteria : null,
        handle: ("handleData" in rule ? rule.handleData : undefined) ?? null,
      });
    }
    return { defs };
  } catch (cause) {
    return { failure: new Error(`${path} does not load`, { cause }) };
  }
}

/**
 * The repo's rules are those of the newest recorded config that loads. A recorded config path may
 * name a config that is gone, so paths are tried newest first and the first failure is reported
 * only when none loads.
 */
async function loadNewestConfig(scanned: { id: string; dir: string }[]): Promise<Loaded> {
  const loaded: Loaded = { defs: new Map(), configPath: null, configFailure: undefined };
  const tried = new Set<string>();
  for (const run of scanned) {
    const path = await configPathOf(run.dir);
    if (path === null || tried.has(path)) continue;
    tried.add(path);
    const attempt = await tryConfig(path);
    if ("defs" in attempt)
      return { defs: attempt.defs, configPath: path, configFailure: undefined };
    loaded.configPath ??= path;
    loaded.configFailure ??= attempt.failure;
  }
  return loaded;
}

export interface RulesRead {
  configPath: string | null;
  configFailure: Error | undefined;
  rules: RuleView[];
}

export type RulesResponse = Omit<RulesRead, "configFailure"> & { configError?: string };

type ScannedRun = { id: string; dir: string };

async function newestRuns(runsRoot: string): Promise<ScannedRun[]> {
  const entries = await readdir(runsRoot, { withFileTypes: true }).catch((err: unknown) => {
    if (isMissingFile(err)) return [];
    throw err;
  });
  const candidates = await collectRunCandidates(
    runsRoot,
    entries.filter((e) => e.isDirectory()).map((e) => e.name),
  );
  candidates.sort((a, b) => b.id.localeCompare(a.id));
  return candidates.slice(0, SCAN);
}

function recordedDigests(summaries: (Summary | null)[]): Map<string, Digest> {
  const defs = new Map<string, Digest>();
  for (let i = summaries.length - 1; i >= 0; i--)
    for (const rule of summaries[i]?.digests ?? []) defs.set(rule.name, rule);
  return defs;
}

function historyOf(name: string, summaries: (Summary | null)[]): RuleRun[] {
  const runs: RuleRun[] = [];
  for (let i = summaries.length - 1; i >= 0; i--) {
    const run = summaries[i]?.byRule.get(name);
    if (run !== undefined && run.n > 0) runs.push(run);
  }
  return runs.slice(-HISTORY);
}

export async function listRules(runsRoot: string): Promise<RulesRead> {
  const scanned = await newestRuns(runsRoot);
  const summaries = await Promise.all(scanned.map((run) => summarize(run.id, run.dir)));
  const { defs: configured, configPath, configFailure } = await loadNewestConfig(scanned);
  const defs = configured.size > 0 ? configured : recordedDigests(summaries);
  const rules: RuleView[] = [];
  for (const digest of defs.values()) {
    const kind = kindOf(digest);
    if (kind === null) continue;
    rules.push({
      name: digest.name,
      kind,
      instructions: digest.instructions,
      criteria: digest.criteria,
      handle: digest.handle,
      runs: historyOf(digest.name, summaries),
    });
  }
  return { configPath, configFailure, rules };
}
