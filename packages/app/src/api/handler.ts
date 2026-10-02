import { readdir, stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
/**
 * THE shared API route module, mounted by both the dev plugin and the prod server. Paths resolve
 * ONLY inside the requests root; anything traversal-shaped is rejected with 400.
 */
import { handleSeverity, type Element, type HandlerData, type Severity } from "@jint/contract";
import type { RequestFile } from "../types";
import type { Dirent } from "node:fs";

export interface ApiOptions {
  /** Absolute requests root. Defaults to the homedir store (~/.jint/runs). */
  root?: string;
}

export function requestsRoot(options: ApiOptions = {}): string {
  // the homedir store works with zero env; options.root overrides (tests, embedded servers)
  return resolve(options.root ?? join(homedir(), ".jint/runs"));
}

/** Collapse the homedir prefix to '~' so run labels stay short (the store lives under ~/.jint). */
const collapseHome = (path: string): string => {
  const home = homedir();
  return path === home ? "~" : path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
};

interface RunSummary {
  id: string;
  mtime: string;
  requests: number;
  /** Absolute config path from manifest.json; null = default rules, or unknown for legacy. */
  configPath: string | null;
  /** The run's source tree (manifest cwd), homedir collapsed to '~'. Absent when unknown. */
  cwd?: string;
  /** Migrated pre-store run: manifest marks it legacy; no cwd/config/report guaranteed. */
  legacy?: boolean;
}

interface RequestItem {
  file: string;
  /** 1-based position in ts order, assigned after parsing. */
  seq: number;
  /** ISO timestamp of the request. */
  ts: string;
  /** True for a one-element call (state carries source); false for a whole-unit call. */
  element: boolean;
  /** Source path the request measured; null when the request carried no path. */
  path: string | null;
  /** The measured element's uuid; null for whole-unit (file-tier) requests. */
  elementId: string | null;
  /** Rule names the request asked, in canonical spelling when the report provides it. */
  rules: string[];
  questionCount: number;
  /** Wall-clock duration, when it can be proven; null rather than an inflated guess. */
  durationMs: number | null;
  /** Highest and lowest noul answer in the request; null when it has none. */
  maxProb: number | null;
  minProb: number | null;
  /** Every noul answer in the request, sorted. Drives histograms. */
  answers: number[];
  /**
   * Provable verdict for the run's rules at this input: finding join first, else the manifest's
   * handle snapshot projected onto the report's measurements. Null = no verdict (never "clean").
   */
  severity: Severity | null;
  /** Per-rule verdicts at this input (span-aware join). Drives per-question answer cards. */
  severities: Record<string, Severity | null>;
}

/**
 * One rule measured against one input (file or element): the atom the grouped table navigates by.
 * Built from the report's measurements, severity joined span-aware (finding first, handle
 * projection second). Empty when the report is degraded/absent - no measurements, no cells.
 */
export interface ApiCell {
  rule: string;
  /** Bare file path, never carrying an element suffix. */
  file: string;
  /** The measured input verbatim: the bare file path, or that path plus the element suffix. */
  input: string;
  /** The measured subject, from the report's Element projection. Absent = whole-unit (file). */
  element?: Element;
  /** The request file this measurement came from (element uuid / file-tier join); direct fetch. */
  requestFile?: string;
  /** The rule's own reading (p-space noul, or a score index for score handles). */
  value: number;
  /** Null = no verdict (never "clean"). */
  severity: Severity | null;
}

export async function serveApiRequest(
  httpRequest: Request,
  apiOptions: ApiOptions = {},
): Promise<Response | null> {
  const requestUrl = new URL(httpRequest.url);
  if (!requestUrl.pathname.startsWith("/api/")) return null;
  const runsRoot = requestsRoot(apiOptions);
  const pathSegments = requestUrl.pathname.split("/").filter(Boolean);
  if (pathSegments[1] !== "runs" || httpRequest.method !== "GET")
    return notFound("no such api route");
  const routeTail = pathSegments.slice(2);
  try {
    // Run ids may be nested (fixture-pipeline layout): the id is resolved segment by segment,
    // so flat and nested runs route identically.
    if (routeTail.length === 0) return jsonResponse(await listRuns(runsRoot));
    const lastSegment = routeTail[routeTail.length - 1]!;
    // a missing report is a first-class absence, never an error
    if (lastSegment === "report" && routeTail.length >= 2) {
      const reportDir = resolveRunDir(runsRoot, routeTail.slice(0, -1));
      if (reportDir === null) return badRequest("invalid run id");
      try {
        return jsonResponse(JSON.parse(await readFile(join(reportDir, "report.json"), "utf8")));
      } catch (err) {
        if (isMissingFileError(err)) return jsonResponse({ absent: true });
        throw err;
      }
    }
    if (routeTail.length >= 3 && routeTail[routeTail.length - 2] === "requests") {
      return serveRunRequest(runsRoot, routeTail.slice(0, -2), routeTail[routeTail.length - 1]!);
    }
    const runDir = resolveRunDir(runsRoot, routeTail);
    if (runDir === null) return badRequest("invalid run id");
    return jsonResponse(await getRun(runsRoot, runDir, routeTail.join("/")));
  } catch (err) {
    // a dropped cause turns a debuggable failure into a mystery: the original error travels
    if (isMissingFileError(err))
      return jsonResponse(
        { error: "not found", detail: err instanceof Error ? err.message : String(err) },
        404,
      );
    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause !== undefined ? String(err.cause) : undefined;
    return jsonResponse({ error: message, ...(cause && { cause }) }, 500);
  }
}

/** Serve one recorded request file of a run; the file name may never leave the run dir. */
async function serveRunRequest(
  runsRoot: string,
  idSegments: string[],
  fileName: string,
): Promise<Response> {
  const runDir = resolveRunDir(runsRoot, idSegments);
  if (runDir === null) return badRequest("invalid run id");
  const requestPath = safeJoin(runDir, fileName);
  if (requestPath === null) return badRequest("invalid request file");
  try {
    return jsonResponse(JSON.parse(await readFile(requestPath, "utf8")));
  } catch (err) {
    if (isMissingFileError(err)) return notFound("request not found");
    throw err;
  }
}

/** True when the error is a missing file — the one case absence is the answer, not a failure. */
function isMissingFileError(err: unknown): boolean {
  const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "";
  return code === "ENOENT";
}

// --- helpers ---------------------------------------------------------------

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const badRequest = (message: string) => jsonResponse({ error: message }, 400);
const notFound = (message: string) => jsonResponse({ error: message }, 404);

/**
 * Resolve name against base, allowing ONLY a single direct child (no traversal, no subdirectory
 * escapes). Returns null when the name tries to leave the base.
 */
function safeJoin(base: string, name: string): string | null {
  if (name.includes("/") || name.includes("\\") || name.includes("\0") || name.startsWith("."))
    return null;
  const full = resolve(join(base, name));
  const baseWithSep = resolve(base) + sep;
  if (!full.startsWith(baseWithSep)) return null;
  return full;
}

/**
 * Resolve a nested run id one safe segment at a time, so traversal in any segment fails the whole
 * id instead of escaping the root. Null when any segment escapes.
 */
function resolveRunDir(root: string, segments: string[]): string | null {
  let dir: string | null = root;
  for (const segment of segments) {
    dir = safeJoin(dir, segment);
    if (dir === null) return null;
  }
  return dir;
}

function isRequestFile(name: string): boolean {
  return /^\d{13}-/.test(name) && name.endsWith(".json");
}

/** Case namespaces must list alongside flat runs, under their nested id. */
async function collectRunCandidates(
  runsRoot: string,
  dirEntries: string[],
): Promise<{ id: string; dir: string }[]> {
  const candidates: { id: string; dir: string }[] = [];
  await Promise.all(
    dirEntries.map(async (entryName) => {
      const dir = join(runsRoot, entryName);
      const files = await readdir(dir).catch((err: unknown) => {
        if (isMissingFileError(err)) return [] as string[];
        throw err;
      });
      if (files.some(isRequestFile)) {
        candidates.push({ id: entryName, dir });
        return;
      }
      for (const caseName of await caseDirsWithRequests(dir))
        candidates.push({ id: `${entryName}/${caseName}`, dir: join(dir, caseName) });
    }),
  );
  return candidates;
}

/** Case dirs one level under a namespace dir, holding at least one recorded request. */
async function caseDirsWithRequests(namespaceDir: string): Promise<string[]> {
  const subEntries = await readdir(namespaceDir, { withFileTypes: true }).catch((err: unknown) => {
    if (isMissingFileError(err)) return [] as Dirent[];
    throw err;
  });
  const subdirNames = subEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const caseDirs: string[] = [];
  await Promise.all(
    subdirNames.map(async (subdirName) => {
      const subdirFiles = await readdir(join(namespaceDir, subdirName)).catch((err: unknown) => {
        if (isMissingFileError(err)) return [] as string[];
        throw err;
      });
      if (subdirFiles.some(isRequestFile)) caseDirs.push(subdirName);
    }),
  );
  return caseDirs;
}

async function readRunSummary(runId: string, runDir: string): Promise<RunSummary> {
  const [dirStats, dirFiles, manifestJson] = await Promise.all([
    stat(runDir),
    readdir(runDir),
    // a manifest-less run still lists: absence of config is data, not a defect
    readFile(join(runDir, "manifest.json"), "utf8").catch((err: unknown) => {
      if (isMissingFileError(err)) return "{}";
      throw err;
    }),
  ]);
  // a manifest-less run reads as unknown-config; a malformed one is a real error and surfaces
  const manifest = JSON.parse(manifestJson) as {
    configPath?: string;
    cwd?: string;
    legacy?: boolean;
  };
  return {
    id: runId,
    mtime: dirStats.mtime.toISOString(),
    requests: dirFiles.filter(
      (name) => name.endsWith(".json") && name !== "report.json" && name !== "manifest.json",
    ).length,
    configPath: manifest?.configPath ?? null,
    cwd: manifest?.cwd !== undefined ? collapseHome(manifest.cwd) : undefined,
    legacy: manifest?.legacy === true,
  };
}

async function listRuns(runsRoot: string): Promise<{ runs: RunSummary[] }> {
  try {
    const entries = await readdir(runsRoot, { withFileTypes: true });
    const dirNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const candidates = await collectRunCandidates(runsRoot, dirNames);
    const runs = await Promise.all(candidates.map(({ id, dir }) => readRunSummary(id, dir)));
    // run id is a unixts: numeric order == chronological
    runs.sort((a, b) => b.id.localeCompare(a.id));
    return { runs };
  } catch (err) {
    // Missing/unreadable root: absence is data, not an error. The runs list contract is
    // ALWAYS an array; an empty one renders as the friendly hint client-side. No path leak.
    const code =
      err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "ENOENT" || code === "ENOTDIR") return { runs: [] };
    throw err;
  }
}

function cellSeverity(
  measurementInput: string,
  ruleName: string,
  findingSeverity: Map<string, Map<string, Severity>>,
  readingsByInput: Map<string, { rule: string; value: number }[]>,
  handlesByRule: Record<string, HandlerData> | null,
): Severity | null {
  // the report's own finding wins; otherwise the handle snapshot projects the reading
  const direct = findingSeverity.get(measurementInput)?.get(ruleName);
  if (direct !== undefined) return direct;
  const handle = handlesByRule?.[ruleName];
  if (handle === undefined) return null;
  for (const { rule: measuredRule, value } of readingsByInput.get(measurementInput) ?? []) {
    if (measuredRule !== ruleName) continue;
    const severity = handleSeverity(value, handle);
    if (severity !== null) return severity;
  }
  return null;
}

/**
 * Parse every request file in the run dir into a summary row. seq is the stable order of requests
 * (by ts, then filename); duration is approximated as file mtime - request ts (the tap writes the
 * file right after the response lands; not a measured latency).
 */
export async function getRun(root: string, dir: string, id: string): Promise<object> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const reportFile = files.includes("report.json");
  const requestFiles = files.filter((f) => f !== "report.json" && f !== "manifest.json");
  // Canonical rule names come from the report (the engine's own spelling). The request question
  // keys are a derived encoding ("<rule> in <element>") and parsing them is lossy when a rule
  // name or element id itself contains " in " - so the report wins whenever it exists.
  let pathRules: Map<string, string[]> | null = null;
  let reportMeasurementCount = 0;
  // per-path measurements, for handle projection of rows without findings
  let pathValues: Map<string, { rule: string; value: number; element?: Element }[]> | null = null;

  // the manifest's handle snapshot: the exact semantics the engine compiled, shipped as data
  let handles: Record<string, HandlerData> | null = null;
  let manifestLegacy = false;
  try {
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as {
      handles?: Record<string, HandlerData>;
      legacy?: boolean;
    };
    if (manifest.handles && Object.keys(manifest.handles).length > 0) handles = manifest.handles;
    manifestLegacy = manifest.legacy === true;
  } catch {
    handles = null;
  }
  // the report's own verdicts: keyed by the FULL finding input (path or path#span). Stripping the
  // span joined a file's worst element verdict onto every sibling element - the exact inversion
  // the handle snapshot exists to prevent.
  const findingSev = new Map<string, Map<string, Severity>>();
  if (reportFile) {
    try {
      const report = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as {
        measurements?: {
          input: string;
          rule: string;
          value?: number;
          element?: Element;
        }[];
        findings?: { input: string; rule: string; severity: Severity }[];
      };
      // the join is (input, rule) - a bare-input key would let one rule's verdict answer
      // another rule's lookup at the same path
      for (const f of report.findings ?? []) {
        const byRule = findingSev.get(f.input) ?? new Map<string, Severity>();
        byRule.set(f.rule, f.severity);
        findingSev.set(f.input, byRule);
      }
      pathRules = new Map();
      pathValues = new Map();
      for (const m of report.measurements ?? []) {
        reportMeasurementCount += 1;
        // pathRules keys on the bare path (requests look up by state.path); pathValues keys on
        // the FULL input (path#span) so projection matches the element identity.
        const path = m.input.split("#")[0];
        const arr = pathRules.get(path);
        if (arr) {
          if (!arr.includes(m.rule)) arr.push(m.rule);
        } else pathRules.set(path, [m.rule]);
        if (typeof m.value === "number") {
          const vals = pathValues.get(m.input);
          const entry = { rule: m.rule, value: m.value, ...(m.element && { element: m.element }) };
          if (vals) vals.push(entry);
          else pathValues.set(m.input, [entry]);
        }
      }
    } catch {
      // unreadable report: fall back to question-key parsing
      pathRules = null;
    }
  }
  // Torn-write guard: the engine now writes report.json atomically, but an old or mid-copy
  // report can still be a fragment. A report with fewer measurements than requests is not
  // authoritative - fall back to question-key parsing and say so (degraded flag). The specific
  // failure this catches: a 6-measurement fragment shadowing every row's rule as the bare-path
  // file measurement with no signal.
  const reportDegraded = pathRules !== null && reportMeasurementCount < requestFiles.length * 0.5;
  if (reportDegraded) {
    pathRules = null;
    pathValues = null;
    findingSev.clear();
  }
  const rows = await Promise.all(
    requestFiles.map(async (file): Promise<RequestItem | null> => {
      try {
        const [text, st] = await Promise.all([
          readFile(join(dir, file), "utf8"),
          stat(join(dir, file)),
        ]);
        const requestFile = JSON.parse(text) as RequestFile;
        const questions = requestFile.request?.questions ?? {};
        const answers = requestFile.response?.answers ?? {};
        const probs = Object.values(answers)
          .map((a) => {
            if (typeof a?.noul === "number") return a.noul;
            // score answers join the p-space summary normalized to 0..1 so a score-only request
            // (or a request whose score is the only answer) is visible in max-p and the strip
            if (typeof a?.score === "number" && a.legend && Object.keys(a.legend).length > 1) {
              return a.score / (Object.keys(a.legend).length - 1);
            }
            return null;
          })
          .filter((n): n is number => n !== null);
        const state = requestFile.request?.state ?? {};
        const rules: string[] = [];
        let elementId: string | null = typeof state.id === "string" ? state.id : null;
        for (const key of Object.keys(questions)) {
          const m = key.match(/^(.+?) in (.+)$/);
          if (m) {
            rules.push(m[1]);
            if (elementId === null) elementId = m[2];
          } else {
            rules.push(key);
          }
        }
        const canonical =
          pathRules !== null && typeof state.path === "string"
            ? pathRules.get(state.path)
            : undefined;

        // severity per rule = finding join first (the report's own verdict, matched by FULL input
        // identity: path#span for elements, bare path for files), else the handle snapshot
        // projected onto that same input's measurement. Null = no provable verdict - the UI
        // never invents "clean" from absence, and a sibling element's verdict never leaks.
        const SEV_RANK: Record<Severity, number> = { warn: 1, error: 2 };
        const keys =
          typeof state.path === "string"
            ? elementId !== null
              ? [`${state.path}#${elementId}`, state.path]
              : [state.path]
            : [];
        const joinSeverity = (rule: string): Severity | null => {
          for (const key of keys) {
            const sev = findingSev.get(key)?.get(rule);
            if (sev !== undefined) return sev;
          }
          return null;
        };
        const projectSeverity = (rule: string): Severity | null => {
          if (handles === null) return null;
          for (const k of keys) {
            for (const { rule: r, value } of pathValues?.get(k) ?? []) {
              if (r !== rule) continue;
              const handle = handles[rule];
              if (handle === undefined) continue;
              const s = handleSeverity(value, handle);
              if (s !== null) return s;
            }
          }
          return null;
        };
        const severities: Record<string, Severity | null> = {};
        let severity: Severity | null = null;
        for (const rule of canonical ?? [...new Set(rules)]) {
          const s = joinSeverity(rule) ?? projectSeverity(rule);
          severities[rule] = s;
          if (s !== null && (severity === null || SEV_RANK[s] > SEV_RANK[severity])) severity = s;
        }
        return {
          file,
          seq: 0,
          ts: requestFile.ts ?? "",
          element: typeof state.source === "string",
          path: typeof state.path === "string" ? state.path : null,
          elementId,
          rules: canonical ?? [...new Set(rules)],
          questionCount: Object.keys(questions).length,
          durationMs:
            Number.isFinite(st.mtimeMs) &&
            requestFile.ts !== undefined &&
            !Number.isNaN(Date.parse(requestFile.ts))
              ? (() => {
                  const ms = Math.max(0, Math.round(st.mtimeMs - Date.parse(requestFile.ts)));
                  // mtime heuristic breaks on moved/copied dirs (rsync/touch inflates it);
                  // >60s for one call is never real - report unknown rather than a 21-minute lie
                  return ms > 60_000 ? null : ms;
                })()
              : null,
          maxProb: probs.length ? Math.max(...probs) : null,
          minProb: probs.length ? Math.min(...probs) : null,
          answers: probs.sort((a, b) => a - b),
          severity,
          severities,
        };
      } catch {
        return null;
      }
    }),
  );
  const parsed = rows.filter((r): r is RequestItem => r !== null);
  parsed.sort((a, b) => a.ts.localeCompare(b.ts) || a.file.localeCompare(b.file));
  parsed.forEach((r, i) => (r.seq = i + 1));
  // flat cell index for the grouped table: one entry per report measurement. pathValues is keyed
  // by the FULL input (path#span), so element identity survives; severity = span-aware join.
  // requestFile joins each measurement back to its request: element cells by the request's
  // elementId (state.id — the uuid the measurement input suffix carries), file-tier cells by the
  // bare path (kind disambiguates a stray element request without an id).
  const elementRequestFile = new Map<string, string>();
  const fileRequestFile = new Map<string, string>();
  for (const r of parsed) {
    if (r.path === null) continue;
    if (r.element) elementRequestFile.set(`${r.path}#${r.elementId}`, r.file);
    else fileRequestFile.set(r.path, r.file);
  }
  const cells: ApiCell[] = [];
  if (pathValues !== null) {
    for (const [input, entries] of pathValues) {
      const file = input.split("#")[0]!;
      const isElement = input.includes("#");
      const requestFile =
        (isElement ? elementRequestFile.get(input) : undefined) ?? fileRequestFile.get(file);
      for (const { rule, value, element } of entries) {
        cells.push({
          rule,
          file,
          input,
          element,
          requestFile,
          value,
          severity: cellSeverity(input, rule, findingSev, pathValues, handles),
        });
      }
    }
  }
  return {
    id,
    requestCount: parsed.length,
    hasReport: reportFile,
    results: parsed,
    handles: handles ?? {},
    cells,
    reportDegraded,
    legacy: manifestLegacy,
  };
}
