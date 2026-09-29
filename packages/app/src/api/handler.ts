import { readdir, stat, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
/**
 * THE shared API route module. Mounted twice: by the vite dev plugin (src/api/vite-plugin.ts) and
 * by the Bun prod server (server.ts). All routes under /api/. Paths resolve ONLY inside the
 * requests root; anything traversal-shaped is rejected with 400.
 */
import { handleSeverity, type HandlerData, type Severity } from "@jint/contract";

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

interface RequestSummary {
  file: string;
  seq: number;
  ts: string;
  kind: "elements" | "files" | "unknown";
  path: string | null;
  elementId: string | null;
  rules: string[];
  questionCount: number;
  durationMs: number | null;
  maxProb: number | null;
  minProb: number | null;
  /** Every noul answer in the capture, sorted. Drives histograms and borderline sort. */
  answers: number[];
  /** Min |noul - 0.5| over the capture's answers: 0 == dead undecided. */
  borderline: number | null;
  /**
   * Provable verdict for the run's rules at this input: finding join first, else the manifest's
   * handle snapshot projected onto the report's measurements. Null = no verdict (never "clean").
   */
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
    if (parts.length === 2 && parts[1] === "runs" && req.method === "GET") {
      return json(await listRuns(root));
    }
    if (parts.length === 3 && parts[1] === "runs" && req.method === "GET") {
      const id = parts[2];
      const dir = safeJoin(root, id);
      if (dir === null) return badRequest("invalid run id");
      return json(await getRun(root, dir, id));
    }
    if (
      parts.length === 4 &&
      parts[1] === "runs" &&
      parts[3] === "report" &&
      req.method === "GET"
    ) {
      const dir = safeJoin(root, parts[2]);
      if (dir === null) return badRequest("invalid run id");
      try {
        return json(JSON.parse(await readFile(join(dir, "report.json"), "utf8")));
      } catch {
        // No fake joins: absence is a first-class answer, not an error.
        return json({ absent: true });
      }
    }
    if (
      parts.length === 5 &&
      parts[1] === "runs" &&
      parts[3] === "requests" &&
      req.method === "GET"
    ) {
      const dir = safeJoin(root, parts[2]);
      if (dir === null) return badRequest("invalid run id");
      const file = safeJoin(dir, parts[4]);
      if (file === null) return badRequest("invalid request file");
      try {
        return json(JSON.parse(await readFile(file, "utf8")));
      } catch {
        return notFound("request capture not found");
      }
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

async function listRuns(root: string): Promise<{ runs: RunSummary[]; hiddenLegacy: number }> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    let notRunCount = 0;
    const legacyDirs = new Set<string>();
    const inspected = await Promise.all(
      dirs.map(async (e) => {
        const dir = join(root, e.name);
        const [st, files, manifest] = await Promise.all([
          stat(dir),
          readdir(dir),
          readFile(join(dir, "manifest.json"), "utf8").catch(() => null),
        ]);
        // captures are recognizable by the tap's name shape: <unixts>-<kind>-<name>.json.
        // Non-run dirs holding loose json (e.g. an assets dir) are thereby not runs.
        const captureCount = files.filter((f) => /^\d{13}-/.test(f) && f.endsWith(".json")).length;
        if (captureCount === 0) {
          // not a run (e.g. an assets dir) - not legacy, just absent
          notRunCount += 1;
          return null;
        }
        if (manifest === null) {
          // legacy run: skipped, counted, never faked
          legacyDirs.add(e.name);
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
          id: e.name,
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
    return { runs, hiddenLegacy: legacyDirs.size };
  } catch (err) {
    // Missing/unreadable root: absence is data, not an error. The runs list contract is
    // ALWAYS an array; an empty one renders as the friendly hint client-side. No path leak.
    const code =
      err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "ENOENT" || code === "ENOTDIR") return { runs: [], hiddenLegacy: 0 };
    throw err;
  }
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
  // per-path measurements, for handle projection of rows without findings
  let pathValues: Map<string, { rule: string; value: number }[]> | null = null;
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
  // the report's own verdicts: input path + rule -> severity (authoritative over projection)
  const findingSev = new Map<string, Severity>();
  if (reportFile) {
    try {
      const report = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as {
        measurements?: { input: string; rule: string; value?: number }[];
        findings?: { input: string; rule: string; severity: Severity }[];
      };
      for (const f of report.findings ?? []) {
        findingSev.set(`${f.input.split("#")[0]}\u0000${f.rule}`, f.severity);
      }
      pathRules = new Map();
      pathValues = new Map();
      for (const m of report.measurements ?? []) {
        const path = m.input.split("#")[0];
        const arr = pathRules.get(path);
        if (arr) {
          if (!arr.includes(m.rule)) arr.push(m.rule);
        } else pathRules.set(path, [m.rule]);
        if (typeof m.value === "number") {
          const vals = pathValues.get(path);
          const entry = { rule: m.rule, value: m.value };
          if (vals) vals.push(entry);
          else pathValues.set(path, [entry]);
        }
      }
    } catch {
      // unreadable report: fall back to question-key parsing
      pathRules = null;
    }
  }
  const rows = await Promise.all(
    captures.map(async (file): Promise<RequestSummary | null> => {
      try {
        const [text, st] = await Promise.all([
          readFile(join(dir, file), "utf8"),
          stat(join(dir, file)),
        ]);
        const capture = JSON.parse(text) as CaptureFile;
        const questions = capture.request?.questions ?? {};
        const answers = capture.response?.answers ?? {};
        const probs = Object.values(answers)
          .map((a) => (typeof a?.noul === "number" ? a.noul : null))
          .filter((n): n is number => n !== null);
        const state = capture.request?.state ?? {};
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
        // severity = finding join first (the report's own verdict), else the handle snapshot
        // projected onto the report's measurement values. Null = no provable verdict - the UI
        // never invents "clean" from absence.
        let severity: Severity | null = null;
        const SEV_RANK: Record<Severity, number> = { warn: 1, error: 2 };
        if (typeof state.path === "string") {
          for (const rule of canonical ?? []) {
            const sev = findingSev.get(`${state.path}\u0000${rule}`);
            if (sev !== undefined && (severity === null || SEV_RANK[sev] > SEV_RANK[severity])) {
              severity = sev;
            }
          }
        }
        if (
          severity === null &&
          typeof state.path === "string" &&
          handles !== null &&
          pathValues !== null
        ) {
          for (const { rule, value } of pathValues.get(state.path) ?? []) {
            const handle = handles[rule];
            if (handle === undefined) continue;
            const s = handleSeverity(value, handle);
            if (s !== null && (severity === null || SEV_RANK[s] > SEV_RANK[severity])) severity = s;
          }
        }
        return {
          file,
          seq: 0,
          ts: capture.ts ?? "",
          kind: /-elements-/.test(file) ? "elements" : /-files-/.test(file) ? "files" : "unknown",
          path: typeof state.path === "string" ? state.path : null,
          elementId,
          rules: canonical ?? [...new Set(rules)],
          questionCount: Object.keys(questions).length,
          durationMs:
            Number.isFinite(st.mtimeMs) &&
            capture.ts !== undefined &&
            !Number.isNaN(Date.parse(capture.ts))
              ? Math.max(0, Math.round(st.mtimeMs - Date.parse(capture.ts)))
              : null,
          maxProb: probs.length ? Math.max(...probs) : null,
          minProb: probs.length ? Math.min(...probs) : null,
          answers: probs.sort((a, b) => a - b),
          borderline: probs.length ? Math.min(...probs.map((n) => Math.abs(n - 0.5))) : null,
          severity,
        };
      } catch {
        return null;
      }
    }),
  );
  const parsed = rows.filter((r): r is RequestSummary => r !== null);
  parsed.sort((a, b) => a.ts.localeCompare(b.ts) || a.file.localeCompare(b.file));
  parsed.forEach((r, i) => (r.seq = i + 1));
  return {
    id,
    requestCount: parsed.length,
    hasReport: reportFile,
    requests: parsed,
    handles: handles ?? {},
  };
}

interface CaptureFile {
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
