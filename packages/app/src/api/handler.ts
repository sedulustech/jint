import { readdir, stat, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
/**
 * THE shared API route module. Mounted twice: by the vite dev plugin (src/api/vite-plugin.ts) and
 * by the Bun prod server (server.ts). All routes under /api/. Paths resolve ONLY inside the
 * requests root; anything traversal-shaped is rejected with 400.
 */
import { handleSeverity, type Element, type HandlerData, type Severity } from "@jint/contract";

export interface ApiOptions {
  /** Absolute requests root. Falls back to JINT_REQUESTS_DIR, then ./tmp/requests. */
  root?: string;
}

export function requestsRoot(opts: ApiOptions = {}): string {
  return resolve(opts.root ?? process.env.JINT_REQUESTS_DIR ?? "tmp/requests");
}

interface RunSummary {
  id: string;
  mtime: string;
  requests: number;
  /** Absolute path of the config that ran, from manifest.json (REQUIRED for a first-class run). */
  configPath: string;
}

interface RequestResult {
  file: string;
  seq: number;
  ts: string;
  /** One-element call (state carries source) vs whole-unit (state carries content). */
  element: boolean;
  path: string | null;
  elementId: string | null;
  rules: string[];
  questionCount: number;
  durationMs: number | null;
  maxProb: number | null;
  minProb: number | null;
  /** Every noul answer in the capture, sorted. Drives histograms. */
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
  /** Bare path: matches state.path, never carries a #span. */
  file: string;
  /** Full measurement input: the file path, or path#uuid for an element. */
  input: string;
  /** The measured subject, from the report's Element projection. Absent = whole-unit (file). */
  element?: Element;
  /** The capture file this measurement came from (element uuid / file-tier join); direct fetch. */
  requestFile?: string;
  /** The rule's own reading (p-space noul, or a score index for score handles). */
  value: number;
  /** Null = no verdict (never "clean"). */
  severity: Severity | null;
}

/** Route an /api/* request. Returns null when the URL is not an API route (caller falls through). */
export async function handleApi(req: Request, opts: ApiOptions = {}): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/")) return null;
  const root = requestsRoot(opts);
  // path segments, empties dropped: ["api", ...]
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    // \"api\"/\"runs\" prefix; the rest is the run id path plus an optional verb. Run ids may
    // be nested (\"generated/elements\", fixture-pipeline layout): the id is resolved segment by
    // segment, so flat and nested runs route identically.
    if (parts[1] === "runs" && req.method === "GET") {
      const tail = parts.slice(2);
      // /api/runs
      if (tail.length === 0) return json(await listRuns(root));
      const verb = tail[tail.length - 1]!;
      // /api/runs/<id...>/report
      if (verb === "report" && tail.length >= 2) {
        const dir = resolveRunDir(root, tail.slice(0, -1));
        if (dir === null) return badRequest("invalid run id");
        try {
          return json(JSON.parse(await readFile(join(dir, "report.json"), "utf8")));
        } catch {
          // No fake joins: absence is a first-class answer, not an error.
          return json({ absent: true });
        }
      }
      // /api/runs/<id...>/requests/<file>
      if (tail.length >= 3 && tail[tail.length - 2] === "requests") {
        const dir = resolveRunDir(root, tail.slice(0, -2));
        if (dir === null) return badRequest("invalid run id");
        const file = safeJoin(dir, tail[tail.length - 1]!);
        if (file === null) return badRequest("invalid request file");
        try {
          return json(JSON.parse(await readFile(file, "utf8")));
        } catch {
          return notFound("request capture not found");
        }
      }
      // /api/runs/<id...> — summary (flat or nested)
      const dir = resolveRunDir(root, tail);
      if (dir === null) return badRequest("invalid run id");
      return json(await getRun(root, dir, tail.join("/")));
    }
    return notFound("no such api route");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ENOENT") || message.includes("not found")) return notFound("not found");
    return json({ error: message }, 500);
  }
}

// --- helpers ---------------------------------------------------------------

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const badRequest = (message: string) => json({ error: message }, 400);
const notFound = (message: string) => json({ error: message }, 404);

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

/** Resolve a multi-segment run id ("generated/elements") one safe segment at a time. */
function resolveRunDir(root: string, segments: string[]): string | null {
  let dir: string | null = root;
  for (const s of segments) {
    dir = safeJoin(dir, s);
    if (dir === null) return null;
  }
  return dir;
}

async function listRuns(root: string): Promise<{
  runs: RunSummary[];
  hiddenLegacy: number;
  legacyRuns: string[];
}> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    let notRunCount = 0;
    const legacyDirs = new Set<string>();
    // Flatten case namespaces (generated/<case>/...) alongside flat runs (run-a/...): a top-level
    // dir holding no captures of its own is scanned one level for capture-bearing case dirs,
    // emitted with the nested id (fixture-pipeline generated/<case> layout).
    const candidates: { id: string; dir: string }[] = [];
    await Promise.all(
      dirs.map(async (e) => {
        const dir = join(root, e.name);
        const files = await readdir(dir).catch(() => []);
        const hasCaptures = files.some((f) => /^\d{13}-/.test(f) && f.endsWith(".json"));
        if (hasCaptures) {
          candidates.push({ id: e.name, dir });
          return;
        }
        const subs = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((s) =>
          s.isDirectory(),
        );
        const caseDirs: string[] = [];
        await Promise.all(
          subs.map(async (s) => {
            const sf = await readdir(join(dir, s.name)).catch(() => []);
            if (sf.some((f) => /^\d{13}-/.test(f) && f.endsWith(".json"))) caseDirs.push(s.name);
          }),
        );
        if (caseDirs.length > 0) {
          for (const s of caseDirs) candidates.push({ id: `${e.name}/${s}`, dir: join(dir, s) });
          return;
        }
        // no captures here or one level down: not a run (assets dir), just absent
        notRunCount += 1;
      }),
    );
    const inspected = await Promise.all(
      candidates.map(async ({ id, dir }): Promise<RunSummary | null> => {
        const [st, files, manifest] = await Promise.all([
          stat(dir),
          readdir(dir),
          readFile(join(dir, "manifest.json"), "utf8").catch(() => null),
        ]);
        if (manifest === null) {
          // legacy run: skipped, counted, never faked
          legacyDirs.add(id);
          return null;
        }
        let configPath: string | null = null;
        try {
          configPath = (JSON.parse(manifest) as { configPath?: string }).configPath ?? null;
        } catch {
          configPath = null;
        }
        // a manifest without a config is not first-class either
        if (configPath === null) return null;
        return {
          id,
          mtime: st.mtime.toISOString(),
          requests: files.filter(
            (f) => f.endsWith(".json") && f !== "report.json" && f !== "manifest.json",
          ).length,
          configPath,
        };
      }),
    );
    const runs = inspected.filter((r): r is RunSummary => r !== null);
    // run id is a unixts: numeric order == chronological
    runs.sort((a, b) => b.id.localeCompare(a.id));
    // legacy = captures without manifest (skipped + counted); not-a-run dirs are just absent
    return { runs, hiddenLegacy: legacyDirs.size, legacyRuns: [...legacyDirs].sort() };
  } catch (err) {
    // Missing/unreadable root: absence is data, not an error. The runs list contract is
    // ALWAYS an array; an empty one renders as the friendly hint client-side. No path leak.
    const code =
      err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "ENOENT" || code === "ENOTDIR")
      return { runs: [], hiddenLegacy: 0, legacyRuns: [] };
    throw err;
  }
}

/**
 * Cell severity for one (input, rule): finding join first, keyed by the FULL measurement input,
 * else the handle snapshot projected onto that input's own reading. Null = no verdict.
 */
function cellSeverity(
  input: string,
  rule: string,
  findingSev: Map<string, Severity>,
  pathValues: Map<string, { rule: string; value: number }[]>,
  handles: Record<string, HandlerData> | null,
): Severity | null {
  const direct = findingSev.get(`${input}\u0000${rule}`);
  if (direct !== undefined) return direct;
  const handle = handles?.[rule];
  if (handle === undefined) return null;
  for (const { rule: r, value } of pathValues.get(input) ?? []) {
    if (r !== rule) continue;
    const s = handleSeverity(value, handle);
    if (s !== null) return s;
  }
  return null;
}

/**
 * Parse every capture in the run dir into a summary row. seq is the stable order of captures (by
 * ts, then filename); duration is approximated as file mtime - capture ts (the tap writes the file
 * right after the response lands; not a measured latency).
 */
export async function getRun(root: string, dir: string, id: string): Promise<object> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const reportFile = files.includes("report.json");
  const captures = files.filter((f) => f !== "report.json" && f !== "manifest.json");
  // Canonical rule names come from the report (the engine's own spelling). The capture question
  // keys are a derived encoding ("<rule> in <element>") and parsing them is lossy when a rule
  // name or element id itself contains " in " - so the report wins whenever it exists.
  let pathRules: Map<string, string[]> | null = null;
  let reportMeasurementCount = 0;
  // per-path measurements, for handle projection of rows without findings
  let pathValues: Map<string, { rule: string; value: number; element?: Element }[]> | null = null;

  // the manifest's handle snapshot: the exact semantics the engine compiled, shipped as data
  let handles: Record<string, HandlerData> | null = null;
  try {
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as {
      handles?: Record<string, HandlerData>;
    };
    if (manifest.handles && Object.keys(manifest.handles).length > 0) handles = manifest.handles;
  } catch {
    handles = null;
  }
  // the report's own verdicts: keyed by the FULL finding input (path or path#span). Stripping the
  // span joined a file's worst element verdict onto every sibling element - the exact inversion
  // the handle snapshot exists to prevent.
  const findingSev = new Map<string, Severity>();
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
      // composite key: the join is (input, rule) - a bare-input key would let one rule's
      // verdict answer another rule's lookup at the same path
      for (const f of report.findings ?? []) {
        findingSev.set(`${f.input}\u0000${f.rule}`, f.severity);
      }
      pathRules = new Map();
      pathValues = new Map();
      for (const m of report.measurements ?? []) {
        reportMeasurementCount += 1;
        // pathRules keys on the bare path (captures look up by state.path); pathValues keys on
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
  // report can still be a fragment. A report with fewer measurements than captures is not
  // authoritative - fall back to question-key parsing and say so (degraded flag). The specific
  // failure this catches: a 6-measurement fragment shadowing every row's rule as the bare-path
  // file measurement with no signal.
  const reportDegraded = pathRules !== null && reportMeasurementCount < captures.length * 0.5;
  if (reportDegraded) {
    pathRules = null;
    pathValues = null;
    findingSev.clear();
  }
  const rows = await Promise.all(
    captures.map(async (file): Promise<RequestResult | null> => {
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
            // score answers join the p-space summary normalized to 0..1 so a score-only capture
            // (or a capture whose score is the only answer) is visible in max-p and the strip
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
          for (const k of keys) {
            const sev = findingSev.get(`${k}\u0000${rule}`);
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
  const parsed = rows.filter((r): r is RequestResult => r !== null);
  parsed.sort((a, b) => a.ts.localeCompare(b.ts) || a.file.localeCompare(b.file));
  parsed.forEach((r, i) => (r.seq = i + 1));
  // flat cell index for the grouped table: one entry per report measurement. pathValues is keyed
  // by the FULL input (path#span), so element identity survives; severity = span-aware join.
  // requestFile joins each measurement back to its capture: element cells by the capture's
  // elementId (state.id — the uuid the measurement input suffix carries), file-tier cells by the
  // bare path (kind disambiguates a stray element capture without an id).
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
  };
}

interface RequestFile {
  ts?: string;
  url?: string;
  status?: number;
  request?: {
    state?: { path?: string; id?: string; [k: string]: unknown };
    questions?: Record<string, unknown>;
    model?: string;
  };
  response?: {
    model?: string;
    answers?: Record<string, { type?: string; noul?: number; [k: string]: unknown }>;
    usage?: Record<string, number>;
  };
}
