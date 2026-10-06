/**
 * Lint — the one function most consumers need. State-in/findings-out: resolves the input, derives
 * each file's element inventory, classifies every element x every inventory-scoped rule in one
 * chunked pass, unit-scoped rules over the whole unit — runs each rule's handle, streams
 * Measurements, Findings and per-unit ClassifyErrors (signalled, but never run-failing).
 *
 * Files fan out in waves of at most FILE_CONCURRENCY in-flight classifier pipelines (design §7.4
 * cost control); events stream per file as its wave completes, measurements before findings.
 *
 * The pipeline never resolves paths it wasn't given, never knows about the terminal, and never
 * throws for per-unit failures (design §1, §7).
 */

import { resolveInput } from "./input/infer.ts";
import { parsePathsList, readPathsSource } from "./input/paths.ts";
import { MAX_ELEMENT_CHARS, type WalkElement } from "./input/walk.ts";
import { createClassifier } from "./jev/client.ts";
import {
  checkRunKnobs,
  createRpsPacer,
  DEFAULT_CONCURRENCY,
  DEFAULT_RPS_BUDGET,
  DEFAULT_TIMEOUT,
  withLimit,
  withPacer,
  withTimeout,
} from "./jev/pacer.ts";
import {
  classifyFile,
  elementWireId,
  rulesForElement,
  selectElement,
  selectElements,
  walkUnit,
  type ClassifyEvent,
  type WalkedUnit,
} from "./rules/classify.ts";
import { judgesWholeUnit } from "./scope.ts";
import { resolveAllTsTargets, runTsRules, type ResolvedTsTargets } from "./tsrules/execute.ts";
import { loadTsConfigRules } from "./tsrules/loader.ts";
import {
  ClassifyError,
  SetupError,
  type InputKind,
  type Classifier,
  type LintEvent,
  type Measurement,
  type Finding,
  type Rule,
  type Unit,
} from "./types.ts";
import type { ResolvedConfig } from "../config/load.ts";
import type { TsRule } from "./tsrules/sdk.ts";

/** Max files with an in-flight classifier pipeline at once (fan-out bound, design §7.4). */
const FILE_CONCURRENCY = 4;

export interface LintOptions {
  config: ResolvedConfig;
  /** Input override (CLI flags); a string[] means explicit file paths. */
  input?: string | string[];
  inputType?: InputKind;
  /** Extra input exclusions, unioned with config.exclude. */
  exclude?: readonly string[];
  /** Sensors removed by name (CLI --disable). */
  disable?: readonly string[];
  /** If set, ONLY these rules run (CLI --rule, repeatable). Applied after disable. */
  only?: readonly string[];
  /** Swappable classifier; defaults to the TypeSafe System One adapter. */
  classifier?: Classifier;
  /**
   * One in-memory str unit (the CLI's piped-stdin form): judged whole under `path` (default
   * "str:stdin"); bypasses input resolution entirely. Its own inventory — every rule judges the
   * whole input, no grammar is ever inferred, and it never WALK_FAILEDs.
   */
  str?: { readonly content: string; readonly path?: string };
  /** Explicit grammar for the str unit (CLI --language); no effect on resolved inputs. */
  language?: string;
  /**
   * In-flight classifier-call ceiling, run-wide (CLI --concurrency; config key of the same name;
   * default 16, max 64). Overrides the config when set.
   */
  concurrency?: number;
  /**
   * Client-side request-start budget, requests/second (CLI --rps-budget; config key rps_budget;
   * default 15, ~75% of the published 20 rps quota). Overrides the config.
   */
  rps_budget?: number;
  /**
   * Per-call timeout in seconds (CLI --timeout; config key of the same name; default 30). A hung
   * call becomes a per-element JEV_TIMEOUT failure instead of pinning a run-wide slot.
   */
  timeout?: number;
  /**
   * A path LIST (the CLI's `paths` noun, whose payload is always `-` — stdin): one path per line,
   * relative to the input dir or absolute — the caller's own VCS pipeline, jint never shells out. A
   * spec may also name an on-disk list file (an SDK-only form; the CLI pipes). The list IS the
   * input selection when no input is otherwise given (the changeset form); when an input is also
   * given, the list never selects.
   */
  paths?: string;
  /**
   * Element-scoped run (CLI `<file>@L<line>`): judge ONE walker element of ONE file. The input is
   * exactly that file; the walked inventory narrows to the selected element, so element jobs fan
   * out to a single classifier call (all of the element's rules batched — fewer with --rule).
   * Whole-unit (files-target) rules never run element-scoped: their claim is about the file, not
   * the element — an explicit --rule naming one is a caller contradiction and fails setup. Dir
   * nouns and str units are incompatible by construction.
   */
  element?: {
    readonly path: string;
    readonly anchor?: number;
    readonly ranges?: readonly { readonly start: number; readonly end: number }[];
  };
}

export async function* lint(options: LintOptions): AsyncGenerator<LintEvent> {
  // The path list (changeset selection): read and parsed ONCE, before the input guard — the
  // list IS the input when nothing else selected one.
  const pathsList =
    options.paths !== undefined ? parsePathsList(await readPathsSource(options.paths)) : undefined;
  if (pathsList !== undefined && pathsList.length === 0) {
    // Fail before the auth gate: an empty list is a caller mistake, not a billing problem.
    throw new SetupError("LIST_EMPTY", "the path list selected no files (empty list)");
  }
  const input: string | string[] | undefined = options.input ?? options.config.input;
  // Backstop for optional config.input: no input at all is a setup failure (the CLI resolves
  // flags > stdin > config before getting here).
  if (
    options.str === undefined &&
    // the changeset form: the LIST is the input (checked below)
    pathsList === undefined &&
    (input === undefined || input === "" || (Array.isArray(input) && input.length === 0))
  ) {
    throw new SetupError(
      "CONFIG_INVALID",
      "no input: pass a path (jint src/), declare piped stdin (jint str - / jint paths - for a path list), or set input in jint.config.json",
    );
  }
  const exclude = [...options.config.exclude, ...(options.exclude ?? [])];
  // Load-time scope warnings (a rule whose exclude cancels its include): in-band, never silent.
  for (const warning of options.config.warnings ?? []) yield { type: "note", note: warning };
  // TS-tier rules load at setup: any load failure (gate, thrown module, invalid defineConfig,
  // duplicate names across both tiers) is fatal and names the file (design rules-context/01).
  const loadedTsRules = await loadTsConfigRules(options.config.tsRules ?? []);
  assertNoCrossTierDuplicates(options.config.rules, loadedTsRules);
  // A str unit has no element inventory: every TS target would resolve to zero elements and the
  // run would complete silently empty. That combination is rejected at setup, not silently
  // no-op'd ("no targets found" for the ENTIRE run is user-visible emptiness, not success).
  if (loadedTsRules.length > 0 && options.str !== undefined) {
    throw new SetupError(
      "CONFIG_INVALID",
      "ts rules run on file inputs only - a str unit has no element inventory, so every ts rule would resolve zero targets (drop tsRules or use a file input)",
    );
  }
  const { json: rules, ts: tsRules } = partitionRules(
    options.config.rules,
    loadedTsRules,
    options.disable,
    options.only,
  );
  // Element scope: files-target rules are claims about the FILE, never one element — they cannot
  // run scoped. An explicitly-named one is a caller contradiction (say so); otherwise they are
  // silently out of the scoped set, like any rule whose target misses the subject.
  let scopedRules = rules;
  if (options.element !== undefined) {
    const whole = rules.filter((rule) => judgesWholeUnit(rule, "file"));
    if (whole.length > 0) {
      const demanded = new Set(whole.map((rule) => rule.name));
      const named = (options.only ?? []).find((name) => demanded.has(name));
      if (named !== undefined)
        throw new SetupError(
          "ELEMENT_NOT_FOUND",
          `rule ${named} judges whole files, not elements - element-scoped runs take inventory-scoped rules`,
        );
      scopedRules = rules.filter((rule) => !judgesWholeUnit(rule, "file"));
    }
  }
  // Auth is global, not per-unit: with rules to classify and no key anywhere, every unit would
  // stream the same JEV_AUTH failure. Fail fast as a setup error, before any input is walked.
  if (
    rules.length + tsRules.length > 0 &&
    options.classifier === undefined &&
    !apiKeyAvailable(options.config.apiKey)
  ) {
    throw new SetupError(
      "CONFIG_INVALID",
      "no TYPESAFE_API_KEY set - measurements need a valid key (override per run: --config with apiKey)",
    );
  }
  // The run knobs: CLI flag > config key > default. Validated here (the SDK boundary) even when
  // the config already validated them - lint() takes options that never passed the loader.
  const concurrency = options.concurrency ?? options.config.concurrency ?? DEFAULT_CONCURRENCY;
  const rpsBudget = options.rps_budget ?? options.config.rps_budget ?? DEFAULT_RPS_BUDGET;
  const timeout = options.timeout ?? options.config.timeout ?? DEFAULT_TIMEOUT;
  const knobProblem = checkRunKnobs({ concurrency, rps_budget: rpsBudget, timeout });
  if (knobProblem !== null) throw new SetupError("CONFIG_INVALID", knobProblem);
  // The classifier seam carries all three knobs - composition order is load-bearing (pacer.ts):
  // the limit caps in-flight calls RUN-WIDE, the pacer spaces ARRIVALS (outside the limit, so a
  // paced caller never holds a slot), the timeout frees a slot when a call hangs. The pacer is
  // the ONLY rate layer - the typesafe SDK already retries with backoff and honors Retry-After.
  const classifier = withLimit(
    withPacer(
      withTimeout(
        options.classifier ?? createClassifier({ apiKey: options.config.apiKey }),
        timeout,
      ),
      createRpsPacer(rpsBudget, concurrency),
    ),
    concurrency,
  );
  // The changeset selection: every listed path is the file's identity verbatim. Entries that
  // resolve to no walked unit (missing, unreadable, non-source) are SIGNAL — a note names them
  // below, never silence.
  const units =
    options.str !== undefined
      ? [strUnit(options.str.content, options.str.path)]
      : pathsList !== undefined && (input === undefined || input === "")
        ? await (async () => {
            // The changeset form: the list IS the judged subject, one entry at a time so a
            // missing or non-source entry degrades to the not-in-the-walk note, never fatal.
            // (An empty list never reaches here: the guard above the auth gate threw LIST_EMPTY.)
            const resolved: Unit[] = [];
            for (const entry of pathsList) {
              try {
                for await (const unit of resolveInput({ input: [entry], inputType: "file" })) {
                  resolved.push(unit);
                }
              } catch (thrown) {
                // missing / unreadable / non-source entries take the note path below, never fatal
                if (
                  thrown instanceof SetupError &&
                  ["ENTRYPOINT_NOT_FOUND", "ENTRYPOINT_UNREADABLE", "NOT_SOURCE"].includes(
                    thrown.code,
                  )
                ) {
                  continue;
                }
                throw thrown;
              }
            }
            return resolved;
          })()
        : await collectUnits(
            resolveInput({
              // the empty-input guard above established non-empty; element scope pins the
              // input to exactly the selector file (dir/config input is ignored)
              input: (options.element !== undefined ? options.element.path : input) as
                | string
                | string[],
              inputType: options.inputType ?? options.config.inputType,
              exclude,
            }),
          );
  // Path-list entries that produced no walked unit (missing, unreadable, non-source) are
  // SIGNAL, never silence: one note names each, the run continues around them.
  const unitPaths = new Set(
    units.map((u) => ("path" in u.state ? u.state.path : "")).filter(Boolean),
  );
  if (pathsList !== undefined) {
    for (const missing of pathsList.filter((p) => !unitPaths.has(p))) {
      yield { type: "note", note: `path list entry not found in the walk: ${missing}` };
    }
  }
  const byName = new Map(scopedRules.map((s) => [s.name, s]));
  let aborted = false;

  // WALK-FIRST (design rules-context/03): one walk over every file unit BEFORE any classification,
  // inventories (metadata + parent links) retained, trees freed inside walkUnit. Peak memory =
  // metadata-so-far + contents-so-far + one tree, the same profile as the old streaming walk.
  const walked = new Map<number, WalkedUnit>();
  for (let i = 0; i < units.length; i += FILE_CONCURRENCY) {
    await Promise.all(
      units.slice(i, i + FILE_CONCURRENCY).map(async (unit, j) => {
        if (unit.kind === "file") {
          walked.set(
            i + j,
            await walkUnit(
              unit,
              options.language !== undefined ? { language: options.language } : {},
            ),
          );
        }
      }),
    );
  }
  // Element-scope narrowing, right after the walk: the single file's inventory collapses to the
  // selected element, so element jobs fan out to ONE classifier call. A selector that names
  // nothing (a line outside every span) is a caller error — fail setup, naming what
  // the file does contain.
  if (options.element !== undefined) {
    const w = walked.get(0);
    if (w === undefined || w.failed !== null)
      throw new SetupError(
        "ELEMENT_NOT_FOUND",
        `cannot resolve element: ${w?.failed ?? "file did not walk"}`,
      );
    const coverage = w.inventory.map((e) => `L${e.span.start.line}-L${e.span.end.line}`).join(", ");
    let selected: WalkElement[];
    if (options.element.anchor !== undefined) {
      // ANCHOR: the unique CONTAINING element - containment, not enclosure (never a degenerate range).
      const anchor = selectElement(w.inventory, { line: options.element.anchor });
      if (anchor === undefined)
        throw new SetupError(
          "ELEMENT_NOT_FOUND",
          `${options.element.path}: line ${options.element.anchor} is inside no element (elements cover: ${coverage})`,
        );
      selected = [anchor];
    } else {
      // RANGE: fully-enclosed only; each comma item resolves independently.
      selected = [];
      for (const range of options.element.ranges ?? []) {
        const enclosed = selectElements(w.inventory, range);
        if (enclosed.length === 0)
          throw new SetupError(
            "ELEMENT_NOT_FOUND",
            `${options.element.path}: no element fully enclosed in L${range.start}-L${range.end} (elements cover: ${coverage})`,
          );
        selected.push(...enclosed);
      }
    }
    const elementOpt = options.element;
    // Payload-less units (comment/import no scoped rule targets) are skipped + counted, never failed.
    const skipped = selected.filter(
      (e) => rulesForElement(scopedRules, e, elementOpt.path).length === 0,
    ).length;
    if (skipped > 0)
      yield {
        type: "note",
        note: `${options.element.path}: ${skipped} payload-less element(s) in selection skipped (comment/import units)`,
      };
    walked.set(0, {
      inventory: selected,
      derived: w.derived,
      failed: null,
      failedCause: undefined,
    });
  }

  // TS-tier resolution ONCE per run over the completed walk, then the retention decision: content
  // of files with zero selected targets is dropped (logical drop, no re-read) unless a files-target
  // JSON rule needs every file's text.
  let tsResolved: ResolvedTsTargets | undefined;
  if (tsRules.length > 0) {
    const elementsByPath = new Map<string, readonly WalkElement[]>();
    for (let i = 0; i < units.length; i++) {
      const w = walked.get(i);
      if (w !== undefined) elementsByPath.set(units[i]!.state.path, w.inventory);
    }
    tsResolved = resolveAllTsTargets(tsRules, elementsByPath);
    // The retention guard is shape-robust on purpose: if the JSON target ever becomes an array
    // form (the TS grammar already allows one), "files" anywhere in the target still retains.
    const wantsAnyFile = (target: Rule["target"]): boolean =>
      Array.isArray(target) ? target.includes("files") : target === "files";
    if (!rules.some((r) => wantsAnyFile(r.target))) {
      const targetPaths = new Set<string>();
      for (const resolved of tsResolved.values()) {
        if ("targets" in resolved) for (const t of resolved.targets) targetPaths.add(t.path);
      }
      for (let i = 0; i < units.length; i++) {
        const unit = units[i]!;
        if (walked.has(i) && !targetPaths.has(unit.state.path)) {
          units[i] = { kind: unit.kind, state: { ...unit.state, content: "" } };
        }
      }
    }
  }

  for (let i = 0; i < units.length && !aborted; i += FILE_CONCURRENCY) {
    const results = await Promise.all(
      units
        .slice(i, i + FILE_CONCURRENCY)
        .map((unit, j) =>
          runUnit(
            unit,
            scopedRules,
            classifier,
            () => aborted,
            options.language,
            walked.get(i + j),
          ),
        ),
    );
    for (let j = 0; j < results.length; j++) {
      const result = results[j]!;
      const unit = units[i + j]!;
      if (result.abort) aborted = true;
      if (result.oversized > 0) {
        const path = "path" in unit.state ? unit.state.path : "unit";
        yield {
          type: "note",
          note:
            path +
            ": " +
            result.oversized +
            " oversized element(s) skipped (over " +
            MAX_ELEMENT_CHARS +
            " chars)",
        };
      }
      for (const note of result.notes) yield { type: "note", note };
      for (const { event, element } of result.events) {
        if (event instanceof ClassifyError) {
          yield { type: "error", error: withLanguageHint(event, options) };
          continue;
        }

        yield { type: "measurement", measurement: { ...event, element } };
        // One pass, no candidacy: every measurement is a reading; the rule's handle is the
        // only threshold. Element readings carry their span into the finding's location.
        const handle = byName.get(event.rule)?.handle;
        // TS-tier events run their own policy pipeline; a rule outside the JSON map has no
        // finding policy here.
        if (handle === undefined) continue;
        // the full answer flows to the handle: score resolution reads value (DEFAULT round) and
        // carries probabilities/confidence for future reads
        const outcome = handle(event);
        if (outcome !== null) {
          // Findings carry no free-form message: consumers join by rule id to the config. Score
          // rules embed the chosen rubric level's legend text (v1.3), so the report displays
          // self-contained; noul findings stay bare.
          const criteria = byName.get(event.rule)?.criteria;
          const note = Array.isArray(criteria) ? criteria[Math.round(event.value)] : undefined;
          yield {
            type: "finding",
            finding: {
              rule: event.rule,
              input: event.input,
              value: event.value,
              severity: outcome.severity,
              ...(note !== undefined && { note }),
              ...(element !== undefined && {
                location: { input: event.input, span: element.span },
              }),
            },
          };
        }
      }
    }
  }

  // TS-tier classification runs after the JSON waves (one resolution, fan-out, policy once per
  // rule); its findings stream at the end of the run, bound to each target's span.
  if (tsResolved !== undefined && !aborted) {
    const phase = await runTsRules(tsRules, tsResolved, classifier, () => aborted);
    for (const event of phase.events) yield event;
    if (phase.fatal) aborted = true;
  }
}

/** A key reaches the classifier via config apiKey or the environment; empty counts as absent. */
function apiKeyAvailable(configKey?: string): boolean {
  return (configKey !== undefined && configKey !== "") || !!process.env.TYPESAFE_API_KEY;
}

/**
 * A str unit's grammar cannot be inferred from an extension — the unit path is synthetic
 * (str:stdin) — so a WALK_FAILED on the piped-stdin path without --language should say so: the fix
 * is declaring the grammar, not renaming a file.
 */
function withLanguageHint(error: ClassifyError, options: LintOptions): ClassifyError {
  if (
    error.code !== "WALK_FAILED" ||
    options.str === undefined ||
    options.language !== undefined ||
    // classify already names the --language remedy for extensionless (stdin) units
    error.message.includes("--language")
  ) {
    return error;
  }
  return new ClassifyError(
    error.code,
    error.input,
    error.message + " — declare the grammar with --language (e.g. --language typescript)",
    { cause: error },
  );
}

/** One unit's pipeline outcome: streamed classification events plus the abort flag. */
interface UnitResult {
  events: ClassifyEvent[];
  abort: boolean;
  oversized: number;
  notes: string[];
}

async function runUnit(
  unit: Unit,
  rules: readonly Rule[],
  classifier: Classifier,
  isAborted: () => boolean,
  language?: string,
  walked?: WalkedUnit,
): Promise<UnitResult> {
  const result = await classifyFile(
    unit,
    rules,
    classifier,
    isAborted,
    language !== undefined ? { language } : {},
    walked,
  );
  // Oversized elements are skipped by the classifier (no rules) — never silent: an in-band note
  // rides the same stream as measurements, and the reporters count it in the run summary.
  return {
    events: result.events,
    abort: result.fatal,
    oversized: result.oversized,
    notes: result.notes,
  };
}

/** A str as one file unit: the piped-stdin path (identity str:stdin unless named). */
function strUnit(content: string, path?: string): Unit {
  return {
    kind: "str",
    state: {
      path: path ?? "str:stdin",
      content,
      id: elementWireId({ start: { line: 1 }, end: { line: content.split("\n").length } }),
    },
  };
}

async function collectUnits<T>(units: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const u of units) out.push(u);
  return out;
}

/** Cheap edit distance for close-match suggestions over rule names. */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length]![b.length]!;
}

/** "unknown rule "x" — did you mean: y?" when a known name is within a typo's distance. */
function unknownRuleMessage(name: string, known: ReadonlySet<string>): string {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of known) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== null && bestDistance <= Math.max(2, Math.floor(name.length / 3))
    ? `unknown rule "${name}" — did you mean: ${best}?`
    : `unknown rule "${name}"`;
}

/** Load-time fatality: a TS rule shadowing a JSON rule (or vice versa) is a config contradiction. */
function assertNoCrossTierDuplicates(jsonRules: readonly Rule[], tsRules: readonly TsRule[]): void {
  const json = new Set(jsonRules.map((rule) => rule.name));
  for (const rule of tsRules) {
    if (json.has(rule.name)) {
      throw new SetupError(
        "RULE_INVALID",
        'duplicate rule name "' +
          rule.name +
          '" in tsRules and the JSON rules tier — names are global across tiers',
      );
    }
  }
}

/**
 * Applies disable/only across BOTH tiers with one shared name space: unknown rule names are a usage
 * error, never a silent empty run (design: setup failures throw, per-unit failures don't).
 */
/**
 * The pure selection half of partitionRules: disable/only set membership, nothing more. No
 * validation, no throw — shared by lint() (after it validates) and the CLI's rules pre-print, so
 * the block always shows exactly the set the run will classify.
 */
export function selectRules(
  jsonRules: readonly Rule[],
  tsRules: readonly TsRule[],
  disable: readonly string[] | undefined,
  only: readonly string[] | undefined,
): { json: Rule[]; ts: TsRule[] } {
  const disabled = disable !== undefined && disable.length > 0 ? new Set(disable) : null;
  const wanted = only !== undefined && only.length > 0 ? new Set(only) : null;
  const keep = (rule: { name: string }): boolean =>
    (disabled === null || !disabled.has(rule.name)) && (wanted === null || wanted.has(rule.name));
  return { json: jsonRules.filter(keep), ts: tsRules.filter(keep) };
}

/**
 * Applies disable/only across BOTH tiers with one shared name space: unknown rule names are a usage
 * error, never a silent empty run (design: setup failures throw, per-unit failures don't).
 */
function partitionRules(
  jsonRules: readonly Rule[],
  tsRules: readonly TsRule[],
  disable: readonly string[] | undefined,
  only: readonly string[] | undefined,
): { json: Rule[]; ts: TsRule[] } {
  const known = new Set([...jsonRules, ...tsRules].map((rule) => rule.name));
  for (const name of disable ?? [])
    if (!known.has(name)) throw new SetupError("CONFIG_INVALID", unknownRuleMessage(name, known));
  for (const name of only ?? [])
    if (!known.has(name)) throw new SetupError("CONFIG_INVALID", unknownRuleMessage(name, known));
  return selectRules(jsonRules, tsRules, disable, only);
}

export interface LintReport {
  measurements: Measurement[];
  findings: Finding[];
  /** Per-unit failures of the request to the classifier: the unit produced no measurement. */
  errors: ClassifyError[];
  /** In-band degradation notes (oversized elements skipped): counted in the run summary. */
  notes: string[];
}

/** Drain the stream into the stable report shape both reporters render. */
export async function collectReport(events: AsyncIterable<LintEvent>): Promise<LintReport> {
  const report: LintReport = { measurements: [], findings: [], errors: [], notes: [] };
  for await (const event of events) {
    if (event.type === "measurement") report.measurements.push(event.measurement);
    else if (event.type === "finding") report.findings.push(event.finding);
    else if (event.type === "error") report.errors.push(event.error);
    else if (event.type === "note") report.notes.push(event.note);
  }
  // Concurrent classification completes out of order; the REPORT is the stable artifact. Every
  // array sorts on a total key over the data (never completion order, never stable-sort tie
  // preservation):
  // - findings: (file, span startByte, span start line, input, rule) - one file can fire one rule
  //   on many elements, so (input, rule) alone can tie. The element id suffix after '#' is a
  //   per-run uuid (element-identity design), so it sorts only as a final tiebreak, never first —
  //   a uuid-first key would make the document ordering differ between identical runs.
  // - measurements: (file, span, input, rule, stage, value); errors: (file, code, message,
  //   input); notes: lexical.
  // The event STREAM stays completion-ordered by design; the serialized document is byte-stable.
  const idFile = (input: string): string => input.split("#")[0] ?? input;
  const spanKey = (f: Finding): number => f.location?.span.startByte ?? -1;
  const lineKey = (f: Finding): number => f.location?.span.start.line ?? -1;
  const measurementSpan = (m: Measurement): number => m.element?.span.startByte ?? -1;
  report.findings.sort(
    (a, b) =>
      idFile(a.input).localeCompare(idFile(b.input)) ||
      spanKey(a) - spanKey(b) ||
      lineKey(a) - lineKey(b) ||
      a.input.localeCompare(b.input) ||
      a.rule.localeCompare(b.rule),
  );
  report.measurements.sort(
    (a, b) =>
      idFile(a.input).localeCompare(idFile(b.input)) ||
      measurementSpan(a) - measurementSpan(b) ||
      a.input.localeCompare(b.input) ||
      a.rule.localeCompare(b.rule) ||
      (a.element?.kind ?? "").localeCompare(b.element?.kind ?? "") ||
      a.value - b.value,
  );
  report.errors.sort(
    (a, b) =>
      idFile(a.input).localeCompare(idFile(b.input)) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message) ||
      a.input.localeCompare(b.input),
  );
  report.notes.sort((a, b) => a.localeCompare(b));
  return report;
}
