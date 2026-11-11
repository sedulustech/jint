import { readdir, stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
/**
 * THE shared API route module, mounted by both the dev plugin and the prod server. Paths resolve
 * ONLY inside the requests root; anything traversal-shaped is rejected with 400.
 */
import {
  choiceTierMass,
  handleSeverity,
  isChoiceHandler,
  readChoice,
  type Element,
  type HandlerData,
  type HandlerLevel,
  type Severity,
} from "@jint/contract";
import { runsBase } from "../core/provider/debug.ts";
import { runCost } from "../core/provider/prices.ts";
import {
  listClassifications,
  recordClassification,
  type ClassificationRecord,
} from "./classifications.ts";
import {
  applyEdit,
  classifyEdited,
  parseEdit,
  type ClassificationEdit,
  type ClassifyOptions,
  type ClassifyRequest,
} from "./classify.ts";
import { normalizeRequestFile, type RequestFile } from "./request-file.ts";
import type { QuestionSchema } from "../core/types.ts";
import type { Dirent } from "node:fs";

export type { RequestFile } from "./request-file.ts";

// filenames and encodings shared across read sites: one name, no drift
const REPORT_FILE = "report.json";
const MANIFEST_FILE = "manifest.json";
const READ_ENCODING = "utf8";
const INVALID_RUN_ID = "invalid run id";
const JSON_SUFFIX = ".json";
const MISSING_ERRNO = "ENOENT";
const HTTP_NOT_FOUND = 404;

export interface ApiOptions extends ClassifyOptions {
  /** Absolute requests root. Defaults to the homedir store (~/.jint/runs). */
  root?: string;
}

export function requestsRoot(options: ApiOptions = {}): string {
  return resolve(options.root ?? runsBase());
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
  /** Distinct rules the run measured (manifest handle snapshot). */
  ruleCount: number;
  /** Absolute config path from manifest.json; null = default rules, or unknown for legacy. */
  configPath: string | null;
  /** The run's source tree (manifest cwd), homedir collapsed to '~'. Absent when unknown. */
  cwd?: string;
  /** Migrated pre-store run: manifest marks it legacy; no cwd/config/report guaranteed. */
  legacy?: boolean;
  /** Wall duration of the run in ms (manifest durationMs); absent on pre-stats runs. */
  durationMs?: number;
  /** Token usage summed across the run's classifier responses; absent on pre-stats runs. */
  usage?: { input: number; output: number; cached?: number };
  /** The model the run asked; absent on runs recorded before the manifest carried it. */
  model?: string;
  /** Input cost in USD at the model's published price; absent when the model is unpriced. */
  cost?: number;
}

export interface RequestItem {
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
   * handle snapshot projected onto the report's classifications. Null = no verdict (never
   * "clean").
   */
  severity: Severity | null;
  /** Per-rule verdicts at this input (span-aware join). Drives per-question answer cards. */
  severities: Record<string, Severity | null>;
}

/**
 * One rule measured against one input (file or element): the atom the grouped table navigates by.
 * Built from the report's classifications, severity joined span-aware (finding first, handle
 * projection second). Empty when the report is degraded/absent - no classifications, no cells.
 */
interface ApiCellBase {
  rule: string;
  /** Bare file path, never carrying an element suffix. */
  file: string;
  /** The measured input verbatim: the bare file path, or that path plus the element suffix. */
  input: string;
  /** The measured subject, from the report's Element projection. Absent = whole-unit (file). */
  element?: Element;
  /** The request file this classification came from (element uuid / file-tier join); direct fetch. */
  requestFile?: string;
  /** The answer cache served this reading: nothing was asked for it in this run. */
  cached?: true;
}

/** A cell with a reading. */
export interface ValuedApiCell extends ApiCellBase {
  /**
   * The rule's own reading: p-space noul, a score index for score handles, and for a choice rule
   * the probability its winning tier holds.
   */
  value: number;
  /** Null = no verdict (never "clean"). */
  severity: Severity | null;
  /** The handle judged the reading and it needs no action. Absent when there is no handle. */
  pass?: true;
  /** A choice reading too close to call: its top tier held less than the handle's ratio. */
  undecided?: true;
  refused?: undefined;
}

/** A refused cell: the model gave no answer, so it has no value and no verdict. */
export interface RefusedApiCell extends ApiCellBase {
  refused: true;
}

export type ApiCell = ValuedApiCell | RefusedApiCell;

/**
 * A choice reading's tier read, for its cell: the probability its winning tier holds, and whether
 * the read was undecided. Undefined when the rule is not a choice rule.
 */
function choiceCellRead(
  handle: HandlerData | undefined,
  choice: string | undefined,
  probabilities: Record<string, number> | undefined,
): Pick<ValuedApiCell, "value" | "undecided"> | undefined {
  if (handle === undefined || !isChoiceHandler(handle) || probabilities === undefined) {
    return undefined;
  }
  const mass = choiceTierMass(handle, probabilities);
  const fired = readChoice(handle, choice, probabilities);
  // an undecided read names its leading tier: the one that fell short of the ratio
  const tier: HandlerLevel =
    fired !== null && fired.undecided !== true
      ? fired.severity
      : fired === null
        ? "pass"
        : (["error", "warn", "pass"] as const).reduce((a, b) => (mass[b] > mass[a] ? b : a));
  const read: Pick<ValuedApiCell, "value" | "undecided"> = { value: mass[tier] };
  if (fired?.undecided === true) read.undecided = true;
  return read;
}

export async function serveApiRequest(
  httpRequest: Request,
  apiOptions: ApiOptions = {},
): Promise<Response | null> {
  const requestUrl = new URL(httpRequest.url);
  if (!requestUrl.pathname.startsWith("/api/")) return null;
  const runsRoot = requestsRoot(apiOptions);
  const pathSegments = requestUrl.pathname.split("/").filter(Boolean);
  if (pathSegments[1] !== "runs") return notFound("no such api route");
  const routeTail = pathSegments.slice(2);
  // an address's classifications live under its run: GET lists them, POST classifies an edit and files it
  if (routeTail.length >= 2 && routeTail[routeTail.length - 1] === "classifications") {
    return serveClassifications(httpRequest, runsRoot, routeTail.slice(0, -1), apiOptions);
  }
  if (httpRequest.method !== "GET") return notFound("no such api route");
  if (routeTail.length >= 2 && routeTail[routeTail.length - 1] === "original") {
    const query = new URL(httpRequest.url).searchParams;
    const [rule, input] = [query.get("rule"), query.get("input")];
    if (rule === null || input === null) return badRequest("rule and input are required");
    try {
      const file = query.get("file") ?? undefined;
      return jsonResponse(
        await readOriginal(routeTail.slice(0, -1).join("/"), { rule, input, file }, apiOptions),
      );
    } catch (err) {
      if (err instanceof AddressError) return jsonResponse({ error: err.message }, err.status);
      throw err;
    }
  }
  try {
    // Run ids may be nested (fixture-pipeline layout): the id is resolved segment by segment,
    // so flat and nested runs route identically.
    if (routeTail.length === 0) return jsonResponse(await listRuns(runsRoot));
    const lastSegment = routeTail[routeTail.length - 1]!;
    // a missing report is a first-class absence, never an error
    if (lastSegment === "report" && routeTail.length >= 2) {
      const reportDir = resolveRunDir(runsRoot, routeTail.slice(0, -1));
      if (reportDir === null) return badRequest(INVALID_RUN_ID);
      try {
        return jsonResponse(await readStoredReport(reportDir));
      } catch (err) {
        if (isMissingFileError(err)) return jsonResponse({ absent: true });
        throw err;
      }
    }
    if (routeTail.length >= 3 && routeTail[routeTail.length - 2] === "requests") {
      return serveRunRequest(runsRoot, routeTail.slice(0, -2), routeTail[routeTail.length - 1]!);
    }
    const runDir = resolveRunDir(runsRoot, routeTail);
    if (runDir === null) return badRequest(INVALID_RUN_ID);
    return jsonResponse(await getRun(runsRoot, runDir, routeTail.join("/")));
  } catch (err) {
    // a dropped cause turns a debuggable failure into a mystery: the original error travels
    if (isMissingFileError(err))
      return jsonResponse(
        { error: "not found", detail: err instanceof Error ? err.message : String(err) },
        HTTP_NOT_FOUND,
      );
    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause !== undefined ? String(err.cause) : undefined;
    return jsonResponse({ error: message, cause }, 500);
  }
}

/** Serve one recorded request file of a run; the file name may never leave the run dir. */
async function serveRunRequest(
  runsRoot: string,
  idSegments: string[],
  fileName: string,
): Promise<Response> {
  const runDir = resolveRunDir(runsRoot, idSegments);
  if (runDir === null) return badRequest(INVALID_RUN_ID);
  const requestPath = safeJoin(runDir, fileName);
  if (requestPath === null) return badRequest("invalid request file");
  try {
    return jsonResponse(
      normalizeRequestFile(JSON.parse(await readFile(requestPath, READ_ENCODING))),
    );
  } catch (err) {
    if (isMissingFileError(err)) return notFound("request not found");
    throw err;
  }
}

/** The error's own code property, when it carries one. */
function errorCode(err: unknown): string {
  return err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "";
}

/** True when the error is a missing file — the one case absence is the answer, not a failure. */
function isMissingFileError(err: unknown): boolean {
  return errorCode(err) === MISSING_ERRNO;
}

/** One line from a thrown value of unknown shape (a non-Error carries only its own text). */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- helpers ---------------------------------------------------------------

/**
 * The classifications of one address under a run. POST classifies an edit, which spends the
 * caller's API key, so it answers only a same-origin JSON request: a JSON content type forces a
 * CORS preflight and the Origin check refuses a foreign page that reaches the loopback port
 * anyway.
 */
async function serveClassifications(
  httpRequest: Request,
  runsRoot: string,
  idSegments: string[],
  apiOptions: ApiOptions,
): Promise<Response> {
  const runDir = resolveRunDir(runsRoot, idSegments);
  if (runDir === null) return badRequest(INVALID_RUN_ID);
  if ((await stat(runDir).catch(() => null)) === null) return notFound("no such run");
  if (httpRequest.method === "GET") {
    const query = new URL(httpRequest.url).searchParams;
    const rule = query.get("rule");
    const input = query.get("input");
    if (rule === null || input === null) return badRequest("rule and input are required");
    return jsonResponse({ classifications: await listClassifications(runDir, rule, input) });
  }
  if (httpRequest.method !== "POST") return notFound("no such api route");
  const origin = httpRequest.headers.get("origin");
  if (origin !== null && new URL(origin).host !== httpRequest.headers.get("host"))
    return jsonResponse({ error: "cross-origin request refused" }, 403);
  if (!httpRequest.headers.get("content-type")?.startsWith("application/json"))
    return badRequest("content-type must be application/json");
  const body = await httpRequest.json().catch(() => null);
  const { rule, input, ...rest } = (body ?? {}) as Record<string, unknown>;
  if (typeof rule !== "string" || typeof input !== "string")
    return badRequest("rule and input must be strings");
  const edit = parseEdit(rest);
  if (typeof edit === "string") return badRequest(edit);
  try {
    const classification = await reclassify(idSegments.join("/"), { rule, input }, edit, {
      ...apiOptions,
      by: "user",
    });
    return jsonResponse({ classification });
  } catch (err) {
    if (err instanceof AddressError) return jsonResponse({ error: err.message }, err.status);
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
}

/**
 * A request about an address the caller can fix: the status is the HTTP one the run UI answers
 * with.
 */
export class AddressError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The original classification of an address, as its run recorded it: the request that read it and
 * its own question and answer.
 */
export interface OriginalRead {
  /** The run's row for the request: its path, element and per-rule severities. */
  result: RequestItem;
  /** The recorded request file, normalized. */
  request: RequestFile;
  /**
   * The classification's own question and answer inside the request; null when the request lacks
   * the rule.
   */
  classification: { key: string; question: QuestionSchema; answer: unknown } | null;
}

/**
 * THE lookup of an address in a run, for everyone: the run view reads it through GET .../original
 * and reclassify starts from it. The request is the one named by `file` when given, else the
 * report's own join for the address, else the request at its path and element.
 */
export async function readOriginal(
  runId: string,
  address: { rule: string; input: string; file?: string },
  options: ApiOptions = {},
): Promise<OriginalRead> {
  const root = requestsRoot(options);
  const runDir = resolveRunDir(root, runId.split("/"));
  if (runDir === null) throw new AddressError(INVALID_RUN_ID, 400);
  if ((await stat(runDir).catch(() => null)) === null)
    throw new AddressError("no such run", HTTP_NOT_FOUND);
  const run = (await getRun(root, runDir, runId)) as { results: RequestItem[]; cells?: ApiCell[] };
  const [path, span] = [
    address.input.split("#")[0]!,
    address.input.includes("#") ? address.input.split("#")[1]! : null,
  ];
  const cellFile = run.cells?.find(
    (c) => c.rule === address.rule && c.input === address.input,
  )?.requestFile;
  const result =
    run.results.find((r) => r.file === address.file) ??
    run.results.find((r) => r.file === cellFile) ??
    // element identity is exact; a bare-path address prefers the file-tier request
    run.results.find(
      (r) => r.path === path && (span !== null ? r.elementId === span : !r.element),
    ) ??
    run.results.find((r) => r.path === path);
  if (result === undefined)
    throw new AddressError(
      `no recorded request for ${address.rule} at ${address.input}`,
      HTTP_NOT_FOUND,
    );
  const request = normalizeRequestFile(
    JSON.parse(await readFile(join(runDir, result.file), READ_ENCODING)),
  );
  const entry = Object.entries(request.request?.questions ?? {}).find(
    ([key]) => (key.match(/^(.*) in (.+)$/)?.[1] ?? key) === address.rule,
  );
  return {
    result,
    request,
    classification:
      entry === undefined
        ? null
        : {
            key: entry[0],
            question: entry[1] as QuestionSchema,
            answer: request.response?.answers?.[entry[0]],
          },
  };
}

/**
 * THE way to classify an edit of a recorded address, for every actor: the run UI (user) and the CLI
 * (agent) both call this. It reads the original through readOriginal, lays the edit over its
 * question and state, asks the classifier once, and files the answer under the run as that
 * address's next classification, recording who filed it.
 */
export async function reclassify(
  runId: string,
  address: { rule: string; input: string },
  edit: ClassificationEdit,
  options: ApiOptions & { by: NonNullable<ClassificationRecord["by"]> },
): Promise<ClassificationRecord> {
  const { request, classification: recorded } = await readOriginal(runId, address, options);
  const state = request.request?.state;
  if (recorded === null || state === undefined)
    throw new AddressError(
      `no recorded classification for ${address.rule} at ${address.input}`,
      HTTP_NOT_FOUND,
    );
  const original: ClassifyRequest = {
    state: { path: state.path, content: state.content, source: state.source },
    question: recorded.question,
  } as ClassifyRequest;
  const edited = applyEdit(original, edit);
  if (typeof edited === "string") throw new AddressError(edited, 400);
  const { answer, wire } = await classifyEdited(edited, options);
  const runDir = resolveRunDir(requestsRoot(options), runId.split("/"))!;
  return recordClassification(runDir, { ...edited, ...address, answer, wire, by: options.by });
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const badRequest = (message: string) => jsonResponse({ error: message }, 400);
const notFound = (message: string) => jsonResponse({ error: message }, HTTP_NOT_FOUND);

/**
 * Resolve name against base, allowing ONLY a single direct child (no traversal, no subdirectory
 * escapes). Returns null when the name classifications to leave the base.
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
  return /^\d{13}-/.test(name) && name.endsWith(JSON_SUFFIX);
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
    readFile(join(runDir, MANIFEST_FILE), READ_ENCODING).catch((err: unknown) => {
      if (isMissingFileError(err)) return "{}";
      throw err;
    }),
  ]);
  // a manifest-less run reads as unknown-config; a malformed one is a real error and surfaces
  const manifest = JSON.parse(manifestJson) as {
    configPath?: string;
    cwd?: string;
    legacy?: boolean;
    handles?: Record<string, HandlerData>;
    durationMs?: number;
    usage?: { input: number; output: number; cached?: number };
    model?: string;
  };
  return {
    id: runId,
    mtime: dirStats.mtime.toISOString(),
    requests: dirFiles.filter(
      (name) => name.endsWith(JSON_SUFFIX) && name !== REPORT_FILE && name !== MANIFEST_FILE,
    ).length,
    ruleCount: Object.keys(manifest.handles ?? {}).length,
    configPath: manifest?.configPath ?? null,
    cwd: manifest?.cwd !== undefined ? collapseHome(manifest.cwd) : undefined,
    legacy: manifest?.legacy === true,
    durationMs: manifest?.durationMs,
    usage: manifest?.usage,
    model: manifest?.model,
    cost: runCost(manifest?.model, manifest?.usage),
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
    const code = errorCode(err);
    if (code === MISSING_ERRNO || code === "ENOTDIR") return { runs: [] };
    throw err;
  }
}

/** One report classification as the run view joins it: a value read, or a refusal with none. */
type Reading =
  | {
      rule: string;
      value: number;
      choice?: string;
      probabilities?: Record<string, number>;
      element?: Element;
      cached?: true;
      refused?: undefined;
    }
  | { rule: string; element?: Element; cached?: true; refused: true };

function cellSeverity(
  classificationInput: string,
  ruleName: string,
  findingSeverity: Map<string, Map<string, Severity>>,
  readingsByInput: Map<string, Reading[]>,
  handlesByRule: Record<string, HandlerData> | null,
): Severity | null {
  // the report's own finding wins; otherwise the handle snapshot projects the reading
  const direct = findingSeverity.get(classificationInput)?.get(ruleName);
  if (direct !== undefined) return direct;
  const handle = handlesByRule?.[ruleName];
  if (handle === undefined) return null;
  for (const reading of readingsByInput.get(classificationInput) ?? []) {
    if (reading.refused || reading.rule !== ruleName) continue;
    const severity = handleSeverity(reading.value, handle, reading.choice, reading.probabilities);
    if (severity !== null) return severity;
  }
  return null;
}

/**
 * The manifest's handle snapshot: the exact semantics the SDK compiled, shipped as data. A missing
 * or unreadable manifest means no projection - rows keep report verdicts only.
 */
async function readManifestHandles(
  dir: string,
): Promise<{ handles: Record<string, HandlerData> | null; legacy: boolean }> {
  try {
    const manifest = JSON.parse(await readFile(join(dir, MANIFEST_FILE), READ_ENCODING)) as {
      handles?: Record<string, HandlerData>;
      legacy?: boolean;
    };
    return {
      handles:
        manifest.handles && Object.keys(manifest.handles).length > 0 ? manifest.handles : null,
      legacy: manifest.legacy === true,
    };
  } catch (err) {
    // A missing manifest is a normal legacy run, not a defect; only a present-but-unreadable file
    // warns, so serving a pre-store run never drags the server log with it.
    if (!isMissingFileError(err)) {
      process.emitWarning(`jint: unreadable manifest in ${dir}: ${errorMessage(err)}`);
    }
    return { handles: null, legacy: false };
  }
}

/**
 * The report's own verdicts and classifications, joined from report.json. Canonical rule names come
 * from the report (the engine's own spelling); the request question keys are a derived encoding
 * ("<rule> in <element>") and parsing them is lossy when a rule name or element id itself contains
 * " in " - so the report wins whenever it exists. Returns null facts when the report is unreadable
 * (fall back to question-key parsing).
 */
async function readReportFacts(dir: string): Promise<{
  findingSev: Map<string, Map<string, Severity>>;
  pathRules: Map<string, string[]> | null;
  pathValues: Map<string, Reading[]> | null;
  classificationCount: number;
}> {
  // the report's own verdicts: keyed by the FULL finding input (path or path#span). Stripping the
  // span joined a file's worst element verdict onto every sibling element - the exact inversion
  // the handle snapshot exists to prevent.
  const findingSev = new Map<string, Map<string, Severity>>();
  let pathRules: Map<string, string[]> | null = null;
  let pathValues: Map<string, Reading[]> | null = null;
  let classificationCount = 0;
  try {
    const report = (await readStoredReport(dir)) as {
      classifications?: {
        input: string;
        rule: string;
        value?: number;
        refused?: boolean;
        cached?: true;
        choice?: string;
        probabilities?: Record<string, number>;
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
    for (const m of report.classifications ?? []) {
      classificationCount += 1;
      // pathRules keys on the bare path (requests look up by state.path); pathValues keys on
      // the FULL input (path#span) so projection matches the element identity.
      const path = m.input.split("#")[0]!;
      const arr = pathRules.get(path);
      if (arr) {
        if (!arr.includes(m.rule)) arr.push(m.rule);
      } else pathRules.set(path, [m.rule]);
      const entry: Reading | null = m.refused
        ? { rule: m.rule, element: m.element, cached: m.cached, refused: true }
        : typeof m.value === "number"
          ? {
              rule: m.rule,
              value: m.value,
              choice: m.choice,
              probabilities: m.probabilities,
              element: m.element,
              cached: m.cached,
            }
          : null;
      if (entry !== null) {
        const vals = pathValues.get(m.input);
        if (vals) vals.push(entry);
        else pathValues.set(m.input, [entry]);
      }
    }
  } catch (err) {
    // Unreadable report: fall back to question-key parsing. The caller marks the run degraded;
    // the cause goes to the log so a truly broken report is never silently rebuilt from request keys.
    process.emitWarning(`jint: unreadable report in ${dir}: ${errorMessage(err)}`);
    return { findingSev, pathRules: null, pathValues: null, classificationCount: 0 };
  }
  return { findingSev, pathRules, pathValues, classificationCount };
}

/**
 * The report facts the run view needs, already guarded. A missing report file means no facts at
 * all; a present-but-torn report falls back to question-key parsing and reports itself degraded,
 * which is the caller's signal that the report is a fragment, not an authority.
 */
async function reportFactsFor(
  dir: string,
  reportFile: boolean,
  requestCount: number,
): Promise<{
  pathRules: Map<string, string[]> | null;
  pathValues: Map<string, Reading[]> | null;
  findingSev: Map<string, Map<string, Severity>>;
  degraded: boolean;
}> {
  const noFacts = {
    pathRules: null,
    pathValues: null,
    findingSev: new Map<string, Map<string, Severity>>(),
    degraded: false,
  };
  if (!reportFile) return noFacts;
  const facts = await readReportFacts(dir);
  // Torn-write guard: the engine writes report.json atomically, but an old or mid-copy report can
  // still be a fragment. A report with fewer classifications than requests is not authoritative -
  // fall back to question-key parsing and say so. The specific failure this catches: a
  // 6-classification fragment shadowing every row's rule as the bare-path file classification.
  if (facts.pathRules === null || facts.classificationCount < requestCount * 0.5) {
    return { ...noFacts, degraded: true };
  }
  return {
    pathRules: facts.pathRules,
    pathValues: facts.pathValues,
    findingSev: facts.findingSev,
    degraded: false,
  };
}

/**
 * A run's report.json. Reports written before the readings were called classifications carry them
 * under `measurements`; the store outlives versions, so that old key reads as the new one here and
 * nothing downstream sees the old name.
 */
async function readStoredReport(dir: string): Promise<Record<string, unknown>> {
  const report = JSON.parse(await readFile(join(dir, REPORT_FILE), READ_ENCODING)) as Record<
    string,
    unknown
  >;
  if (report.classifications === undefined && report.measurements !== undefined) {
    const { measurements, ...rest } = report;
    return { ...rest, classifications: measurements };
  }
  return report;
}

/**
 * One request file to one summary row, or null when the file is unreadable. seq stays 0 here: the
 * caller numbers rows after sorting them into ts order.
 */
async function readRequestRow(
  dir: string,
  file: string,
  pathRules: Map<string, string[]> | null,
  pathValues: Map<string, Reading[]> | null,
  findingSev: Map<string, Map<string, Severity>>,
  handles: Record<string, HandlerData> | null,
  kinds: Map<string, string>,
): Promise<RequestItem | null> {
  try {
    const [text, st] = await Promise.all([
      readFile(join(dir, file), READ_ENCODING),
      stat(join(dir, file)),
    ]);
    const requestFile: RequestFile = normalizeRequestFile(JSON.parse(text));
    const questions = requestFile.request?.questions ?? {};
    const answers = requestFile.response?.answers ?? {};
    const probs = Object.entries(answers)
      .map(([key, a]) => {
        if (typeof a?.noul === "number") return a.noul;
        // a choice answer joins the p-space summary as its selected option's probability
        if (typeof a?.choice === "string") return a.probabilities?.[a.choice] ?? null;
        // score answers join the p-space summary normalized to 0..1 so a score-only request
        // (or a request whose score is the only answer) is visible in max-p and the strip; the
        // level count is the question's, not an echo the model may leave out
        const levels = questions[key]?.criteria;
        if (typeof a?.score === "number" && Array.isArray(levels) && levels.length > 1) {
          return a.score / (levels.length - 1);
        }
        return null;
      })
      .filter((n): n is number => n !== null);
    const state = requestFile.request?.state ?? {};
    // the recorded path first: the wire body carries one only for a rule that includes it
    const statePath =
      typeof requestFile.path === "string"
        ? requestFile.path
        : typeof state.path === "string"
          ? state.path
          : null;
    const rules: string[] = [];
    let elementId: string | null =
      typeof requestFile.id === "string"
        ? requestFile.id
        : typeof state.id === "string"
          ? state.id
          : null;
    for (const [key, question] of Object.entries(questions)) {
      const m = key.match(/^(.+?) in (.+)$/);
      const rule = m ? m[1]! : key;
      rules.push(rule);
      if (m && elementId === null) elementId = m[2]!;
      // the question's wire type is its rule's kind: noul, score or choice
      if (typeof question?.type === "string") kinds.set(rule, question.type);
    }
    const canonical =
      pathRules !== null && statePath !== null ? pathRules.get(statePath) : undefined;

    // severity per rule = finding join first (the report's own verdict, matched by FULL input
    // identity: path#span for elements, bare path for files), else the handle snapshot
    // projected onto that same input's classification. Null = no provable verdict - the UI
    // never invents "clean" from absence, and a sibling element's verdict never leaks.
    const SEV_RANK: Record<Severity, number> = { warn: 1, error: 2 };
    const keys =
      statePath !== null
        ? elementId !== null
          ? [`${statePath}#${elementId}`, statePath]
          : [statePath]
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
      for (const key of keys) {
        for (const reading of pathValues?.get(key) ?? []) {
          if (reading.refused || reading.rule !== rule) continue;
          const handle = handles[rule];
          if (handle === undefined) continue;
          const s = handleSeverity(reading.value, handle, reading.choice, reading.probabilities);
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
      path: statePath,
      elementId,
      rules: canonical ?? [...new Set(rules)],
      questionCount: Object.keys(questions).length,
      durationMs:
        typeof requestFile.durationMs === "number"
          ? requestFile.durationMs
          : Number.isFinite(st.mtimeMs) &&
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
  } catch (err) {
    // An unreadable request file drops its row: the run view shows the rows it can prove, and the
    // cause goes to the log rather than a silent hole in the table.
    process.emitWarning(`jint: unreadable request file ${file} in ${dir}: ${errorMessage(err)}`);
    return null;
  }
}

export async function getRun(root: string, dir: string, id: string): Promise<object> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(JSON_SUFFIX));
  const reportFile = files.includes(REPORT_FILE);
  const requestFiles = files.filter((f) => f !== REPORT_FILE && f !== MANIFEST_FILE);
  const { handles, legacy: manifestLegacy } = await readManifestHandles(dir);
  const {
    pathRules,
    pathValues,
    findingSev,
    degraded: reportDegraded,
  } = await reportFactsFor(dir, reportFile, requestFiles.length);
  const kinds = new Map<string, string>();
  const rows = await Promise.all(
    requestFiles.map((file) =>
      readRequestRow(dir, file, pathRules, pathValues, findingSev, handles, kinds),
    ),
  );
  const resultRows = rows.filter((row): row is RequestItem => row !== null);
  resultRows.sort((a, b) => a.ts.localeCompare(b.ts) || a.file.localeCompare(b.file));
  resultRows.forEach((row, i) => (row.seq = i + 1));
  // one cell per report classification. pathValues is keyed by the FULL input (path#span), so
  // element identity survives; severity = span-aware join. requestFile joins each classification
  // back to its request: element cells by the request's elementId (state.id — the uuid the
  // classification input suffix carries), file-tier cells by the bare path (kind disambiguates a
  // stray element request without an id).
  const elementRequestFile = new Map<string, string>();
  const fileRequestFile = new Map<string, string>();
  for (const row of resultRows) {
    if (row.path === null) continue;
    if (row.element) elementRequestFile.set(`${row.path}#${row.elementId}`, row.file);
    else fileRequestFile.set(row.path, row.file);
  }
  const cells: ApiCell[] = [];
  if (pathValues !== null) {
    for (const [input, entries] of pathValues) {
      const file = input.split("#")[0]!;
      const isElement = input.includes("#");
      const requestFile =
        (isElement ? elementRequestFile.get(input) : undefined) ?? fileRequestFile.get(file);
      for (const reading of entries) {
        const { rule, element } = reading;
        if (reading.refused) {
          cells.push({
            rule,
            file,
            input,
            element,
            requestFile,
            cached: reading.cached,
            refused: true,
          });
          continue;
        }
        const { value, choice, probabilities } = reading;
        const cell: ValuedApiCell = {
          rule,
          file,
          input,
          element,
          requestFile,
          cached: reading.cached,
          value,
          severity: cellSeverity(input, rule, findingSev, pathValues, handles),
          ...choiceCellRead(handles?.[rule], choice, probabilities),
        };
        // a silent handle is a pass; without a handle the reading has no verdict at all
        if (cell.severity === null && cell.undecided !== true && handles?.[rule] !== undefined) {
          cell.pass = true;
        }
        cells.push(cell);
      }
    }
  }
  return {
    id,
    requestCount: resultRows.length,
    hasReport: reportFile,
    results: resultRows,
    handles: handles ?? {},
    kinds: Object.fromEntries(kinds),
    cells,
    reportDegraded,
    legacy: manifestLegacy,
  };
}
