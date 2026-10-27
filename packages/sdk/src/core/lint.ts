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

import { loadCustomGrammars } from "./grammars/grammars.ts";
import { assertCaptureAddress } from "./grammars/query.ts";
import {
  grammarExtensions,
  MAX_ELEMENT_TOKENS,
  unclaimedExtension,
  type GrammarRegistry,
  type InventoryElement,
} from "./grammars/walk.ts";
import { denylistMatch, SECRET_DENYLIST, type OwnedScope } from "./input/dir.ts";
import { inferKind, resolveInput } from "./input/infer.ts";
import { parsePathsList } from "./input/paths.ts";
import {
  inputStats,
  renderInputSummary,
  type InputStats,
  type InputSummary,
} from "./input/stats.ts";
import { createClassifier } from "./provider/client.ts";
import { recordSummary } from "./provider/debug.ts";
import {
  checkRunKnobs,
  DEFAULT_CONCURRENCY,
  DEFAULT_TIMEOUT,
  withLimit,
  withTimeout,
  withTokenRate,
} from "./provider/pacer.ts";
import { assertProviderKey, resolveProvider } from "./provider/providers.ts";
import {
  classifyFile,
  elementWireId,
  rulesForElement,
  selectElement,
  selectElements,
  walkUnit,
  type ClassifyEvent,
  type OversizedElement,
  type WalkedUnit,
} from "./rules/classify.ts";
import {
  resolveAllCustomTargets,
  runCustomRules,
  type ResolvedCustomTargets,
} from "./rules/custom/execute.ts";
import {
  configScopeAdmits,
  judgesWholeUnit,
  ruleScopeClaims,
  ruleInScope,
  walkScopes,
} from "./scope.ts";
import {
  ClassifyError,
  SetupError,
  type InputKind,
  type Classifier,
  type Element,
  type LintEvent,
  type Measurement,
  type ValuedMeasurement,
  type Finding,
  type Rule,
  type Unit,
} from "./types.ts";
import type { ResolvedConfig } from "../config/load.ts";
import type { SelectedElement } from "./output/echo.ts";
import type { CustomRule } from "./rules/custom/schema.ts";
import type { RuleDigest } from "@jint/contract";

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
   * The transport log sink (vendor backoff/warn/error visibility), called with one UNPREFIXED line
   * per event: the tool prefix is the client's voice, never the SDK's. Only reaches the default
   * classifier (an explicit classifier carries its own logging).
   */
  log?: (line: string) => void;
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
   * Per-call timeout in seconds (CLI --timeout; config key of the same name; default 30). A hung
   * call becomes a per-element PROVIDER_TIMEOUT failure instead of pinning a run-wide slot.
   */
  timeout?: number;
  /**
   * Config-scope basis for dir inputs: the dir-walk root's path relative to the config's directory.
   * Dir-walked paths and scope patterns (config exclude + per-rule include/exclude) share this
   * basis, so a config pattern naming the tests subtree excludes the dir walk even when its root is
   * the tests dir itself. Empty or undefined = dir-walk-root basis. The CLI derives it from the
   * config location; SDK callers walking arbitrary trees leave it unset.
   */
  scopeBase?: string;
  /**
   * A path LIST (the CLI's `paths` noun): the ALREADY-READ text, one path per line, relative to the
   * input dir or absolute — the caller's own VCS pipeline, jint never shells out. Same boundary as
   * `str`'s content: the SDK takes values, the caller does I/O (no spec, no magic "-" — a consumer
   * with a list file reads it and passes the text). No identity field: a list is not a judged unit
   * — its ENTRIES are the identities, and nothing in a report represents the list itself. The list
   * IS the input selection when no input is otherwise given (the changeset form); when an input is
   * also given, the list never selects.
   */
  paths?: { readonly content: string };
  /**
   * Element-scoped run (CLI `<file>@L<line>`): judge ONE inventory element of ONE file. The input
   * is exactly that file; the inventory narrows to the selected element, so element jobs fan out to
   * a single classifier call (all of the element's rules batched — fewer with --rule). Whole-unit
   * (files-target) rules never run element-scoped: their claim is about the file, not the element —
   * an explicit --rule naming one is a caller contradiction and fails setup. Dir nouns and str
   * units are incompatible by construction.
   */
  element?: {
    readonly path: string;
    readonly anchor?: number;
    readonly ranges?: readonly { readonly start: number; readonly end: number }[];
  };
}

/**
 * Why one target does not apply to one element. The reason is per (target, element) pair, so the
 * skip note can say precisely why no requested rule matched - never a generic parenthetical.
 */
function scopeSkipReason(target: string, element: InventoryElement): string {
  if (element.oversized === true) return "exceeds the size backstop";
  if (target === "comments") return "carries none";
  return `is a ${element.capture}`;
}

/** The honest skip line: element identity, per-requested-rule mismatch, zero calls spent. */
function scopeSkipNote(path: string, element: InventoryElement, rules: readonly Rule[]): string {
  const span = `L${element.span.start.line}-L${element.span.end.line}`;
  const mismatches = rules
    .map((rule) => {
      const targets = Array.isArray(rule.target) ? rule.target : [rule.target];
      return `${rule.name} measures ${targets.join(",")} (${element.label} ${scopeSkipReason(targets[0]!, element)})`;
    })
    .join(", ");
  return `${path}: ${element.label} (${span}) not measured - no requested rule applies: ${mismatches}; zero classifier calls were made for this selection`;
}

/**
 * Element-scope narrowing: the single file's inventory collapses to the selected element, so
 * element jobs fan out to ONE classifier call. A selector that names nothing (a line outside every
 * span) is a caller error — fail setup, naming what the file does contain. Elements no scoped rule
 * targets come back as `skipped` for the caller to name, never silence.
 */
function selectScopedElements(
  w: WalkedUnit,
  element: NonNullable<LintOptions["element"]>,
  scopedRules: readonly Rule[],
): { selected: InventoryElement[]; skipped: InventoryElement[] } {
  if (w.failed !== null)
    throw new SetupError("ELEMENT_NOT_FOUND", `cannot resolve element: ${w.failed}`);
  const coverage = w.inventory.map((e) => `L${e.span.start.line}-L${e.span.end.line}`).join(", ");
  let selected: InventoryElement[];
  if (element.anchor !== undefined) {
    // ANCHOR: the unique CONTAINING element - containment, not enclosure (never a degenerate range).
    const anchor = selectElement(w.inventory, { line: element.anchor });
    if (anchor === undefined)
      throw new SetupError(
        "ELEMENT_NOT_FOUND",
        `${element.path}: line ${element.anchor} is inside no element (elements cover: ${coverage})`,
      );
    selected = [anchor];
  } else {
    // RANGE: fully-enclosed only; each comma item resolves independently.
    selected = [];
    for (const range of element.ranges ?? []) {
      const enclosed = selectElements(w.inventory, range);
      if (enclosed.length === 0)
        throw new SetupError(
          "ELEMENT_NOT_FOUND",
          `${element.path}: no element fully enclosed in L${range.start}-L${range.end} (elements cover: ${coverage})`,
        );
      selected.push(...enclosed);
    }
  }
  const skipped = selected.filter(
    (candidate) => rulesForElement(scopedRules, candidate, element.path).length === 0,
  );
  return { selected, skipped };
}

/**
 * THE CAPTURE-ADDRESS GATE, over the run's registry and before any file walks: a shadow grammar
 * REPLACES its embedded extraction, so the emitted set for an id is the shadow's once merged.
 * Config load stays grammar-blind (no registry is built there); the loudness point in the user's
 * experience is identical: CONFIG_INVALID, nothing measured.
 */
function assertTargetsAddressable(config: ResolvedConfig, registry: GrammarRegistry): void {
  for (const rule of config.rules) {
    for (const t of typeof rule.target === "string" ? [rule.target] : rule.target) {
      assertCaptureAddress(t, registry);
    }
  }
  for (const rule of config.customRules ?? []) {
    const targets = Array.isArray(rule.target) ? rule.target : [rule.target];
    for (const t of targets) {
      if (typeof t === "string") assertCaptureAddress(t, registry);
    }
  }
}

function assertInputSelected(
  options: LintOptions,
  pathsList: readonly string[] | undefined,
  input: string | string[] | undefined,
): void {
  if (
    options.str === undefined &&
    pathsList === undefined &&
    (input === undefined || input === "" || (Array.isArray(input) && input.length === 0))
  ) {
    throw new SetupError(
      "CONFIG_INVALID",
      "no input: pass an input path, declare piped stdin (str for one source, paths for a path list), or set input in the config",
    );
  }
}

function assertApiKeyForRules(ruleCount: number, options: LintOptions): void {
  if (ruleCount > 0 && options.classifier === undefined) assertProviderKey(options.config);
}

/**
 * The run knobs: CLI flag > config key > default. Validated here (the SDK boundary) even when the
 * config already validated them - lint() takes options that never passed the loader.
 */
function resolveRunKnobs(options: LintOptions): { concurrency: number; timeout: number } {
  const concurrency = options.concurrency ?? options.config.concurrency ?? DEFAULT_CONCURRENCY;
  const timeout = options.timeout ?? options.config.timeout ?? DEFAULT_TIMEOUT;
  const problem = checkRunKnobs({ concurrency, timeout });
  if (problem !== null) throw new SetupError("CONFIG_INVALID", problem);
  return { concurrency, timeout };
}

/**
 * The classifier seam carries all three knobs - composition order is load-bearing: the limit caps
 * in-flight calls RUN-WIDE, the pacer spaces ARRIVALS (outside the limit, so a paced caller never
 * holds a slot), the timeout frees a slot when a call hangs.
 */
function pacedClassifier(
  options: LintOptions,
  knobs: { concurrency: number; timeout: number },
): Classifier {
  const injected = options.classifier;
  const classifier =
    injected ??
    createClassifier({
      apiKey: options.config.apiKey,
      provider: options.config.provider,
      model: options.config.model,
      providers: options.config.providers,
      log: options.log,
    });
  // An injected classifier is not a provider's: no provider budget applies to it.
  const budget =
    injected === undefined
      ? resolveProvider(options.config).spec.limits?.tokensPerMinute
      : undefined;
  return withTokenRate(
    withLimit(withTimeout(classifier, knobs.timeout), knobs.concurrency),
    budget,
  );
}

export async function* lint(options: LintOptions): AsyncGenerator<LintEvent> {
  // The run's registry VALUE, built once here and threaded through every walk/query entry point:
  // the grammar dir's customs merge over the embedded base (a custom wasm wins over embedded for
  // the same id; an .scm + extensions.json dir without a wasm shadows an embedded grammar's
  // extraction). The value dies with the run - nothing module-level remains to leak between runs.
  // Scan coverage (loose files, unreadable dirs) surfaces as a note, like the dir-walk notes.
  const grammarNotes: string[] = [];
  const registry = await loadCustomGrammars(undefined, (note) => grammarNotes.push(note));
  for (const note of grammarNotes) {
    yield { type: "note", note };
  }
  assertTargetsAddressable(options.config, registry);
  // The path list (changeset selection): read and parsed ONCE, before the input guard — the
  // list IS the input when nothing else selected one.
  const pathsList = options.paths !== undefined ? parsePathsList(options.paths.content) : undefined;
  if (pathsList !== undefined && pathsList.length === 0) {
    // Fail before the auth gate: an empty list is a caller mistake, not a billing problem.
    throw new SetupError("LIST_EMPTY", "the path list selected no files (empty list)");
  }
  const input: string | string[] | undefined = options.input ?? options.config.input;
  assertInputSelected(options, pathsList, input);
  // Load-time scope warnings (a rule whose exclude cancels its include): in-band, never silent.
  for (const warning of options.config.warnings ?? []) yield { type: "note", note: warning };
  // Inline callback rules come from the config boundary, already validated (load-time duplicates
  // and scopes are fatal there); lint only selects across both rule forms.
  const { json: rules, custom: customRules } = partitionRules(
    [...options.config.rules],
    options.config.customRules ?? [],
    options.disable,
    options.only,
  );
  // A str unit has no element inventory: every callback target would resolve to zero elements and
  // the run would complete silently empty. That combination is rejected at setup, not silently
  // no-op'd ("no targets found" for the ENTIRE run is user-visible emptiness, not success).
  if (customRules.length > 0 && options.str !== undefined) {
    throw new SetupError(
      "CONFIG_INVALID",
      "callback rules run on file inputs only - a str unit has no element inventory, so every callback rule would resolve zero targets (drop them or use a file input)",
    );
  }
  const scopedRules = scopeElementRules(rules, options);
  // The report is self-describing about its rules: one digest per rule that ran (defaults +
  // config-authored custom rules; handle null for callback policies - no declarative tiers).
  yield {
    type: "rules",
    rules: [...rules, ...customRules].map((rule) => ({
      name: rule.name,
      // a custom callback rule is code policy: no declarative criteria or tier form to publish
      criteria: "criteria" in rule ? rule.criteria : null,
      handle: ("handleData" in rule ? rule.handleData : undefined) ?? null,
    })),
  };
  assertApiKeyForRules(rules.length + customRules.length, options);
  // An override of the provider's url or key is visible, never silent (names only, no key value).
  if (options.classifier === undefined && rules.length + customRules.length > 0) {
    for (const note of resolveProvider(options.config).notes) yield { type: "note", note };
  }
  const knobs = resolveRunKnobs(options);
  const classifier = pacedClassifier(options, knobs);
  // The changeset selection: every listed path is the file's identity verbatim. Entries that
  // resolve to no walked unit (missing, unreadable, non-source) are SIGNAL — a note names them
  // below, never silence. Walk coverage notes (the secret-shaped denylist's one-note-per-class
  // skips) surface here.
  const walkerNotes: string[] = [];
  const stats = inputStats();
  const admission = await resolveRunUnits(
    options,
    pathsList,
    input,
    rules,
    customRules,
    registry,
    (note) => walkerNotes.push(note),
    stats,
  );
  const units = admission.units;
  // THE config-scope gate for rule selection: unscoped rules follow the config scope
  // (include whitelist AND not excluded), so they measure exactly the files that scope admits -
  // never files only a rule scope claimed. Scoped rules (include declared) follow their OWN
  // include, claiming across the config exclude; the always-true inputs are str and the paths
  // list only (no path semantics) - file operands and element scope evaluate the real predicate.
  const inScopeFor = (rule: Rule | CustomRule, path: string): boolean =>
    ruleInScope(rule, path) && (rule.include !== undefined || admission.configAdmits(path));
  // The input accounting (run.input): how many files, and why not all measured. Emitted as an
  // event so the report reads ONE source of truth; the human stderr line rides the
  // notes channel (same doctrine as the denylist coverage notes) whenever anything was dropped.
  yield { type: "input", summary: stats.summary() };
  for (const line of renderInputSummary(stats.summary(), admission.scopes)) {
    yield { type: "note", note: line };
  }
  for (const note of unwalkedListEntryNotes(pathsList, units)) {
    yield { type: "note", note };
  }
  // the walk's denylist coverage notes (one per class), in walk order - signal, not silence
  for (const note of walkerNotes) {
    yield { type: "note", note };
  }
  const byName = new Map(scopedRules.map((s) => [s.name, s]));
  let aborted = false;

  // WALK-FIRST (design rules-context/03): one walk over every file unit BEFORE any
  // classification, taken only where a consumer exists.
  const { walked, skippedExtensions } = await walkedInventories(
    units,
    options,
    rules,
    customRules,
    registry,
    inScopeFor,
  );
  // Sweep coverage: unsupported extensions are expected — reported once, never an error. The
  // union of what is parsed and what was seen-but-skipped is the run's honesty line.
  if (skippedExtensions.size > 0) {
    yield { type: "note", note: sweepCoverageNote(skippedExtensions, registry) };
  }
  // Element-scope narrowing, right after the walk: the single file's inventory collapses to the
  // selected element, so element jobs fan out to ONE classifier call.
  if (options.element !== undefined) {
    const w = walked.get(0);
    if (w === undefined)
      throw new SetupError("ELEMENT_NOT_FOUND", "cannot resolve element: file did not walk");
    // Elements no scoped rule targets are skipped + named, never failed: the note says WHICH
    // element, WHICH rules were requested, WHY nothing applies, and that no classifier call was
    // spent - a scoped run that measured nothing must never read as a clean pass.
    const { selected, skipped } = selectScopedElements(w, options.element, scopedRules);
    for (const element of skipped) {
      yield { type: "note", note: scopeSkipNote(options.element.path, element, scopedRules) };
    }
    walked.set(0, {
      inventory: selected,
      derived: w.derived,
      failed: null,
      failedCause: undefined,
    });
  }

  // custom-tier resolution ONCE per run over the completed walk, then the retention decision:
  // content of files with zero selected targets is dropped (logical drop, no re-read) unless a
  // files-target JSON rule needs every file's text.
  let customResolved: ResolvedCustomTargets | undefined;
  if (customRules.length > 0) {
    customResolved = resolveAllCustomTargets(customRules, elementsByPathOf(units, walked));
    if (!rules.some((r) => targetsFiles(r.target))) {
      retainTargetedContent(units, walked, customResolved);
    }
  }

  // the JSON-rule waves: files classify in bounded waves, each wave's results streamed as they
  // land (measurements before findings)
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
            registry,
            walked.get(i + j),
            admission.configAdmits(unit.state.path),
          ),
        ),
    );
    for (let j = 0; j < results.length; j++) {
      const result = results[j]!;
      if (result.abort) aborted = true;
      yield* unitOutcomeEvents(result, units[i + j]!, byName, options);
    }
  }

  // custom-tier classification runs after the JSON waves (one resolution, fan-out, policy once per
  // rule); its findings stream at the end of the run, bound to each target's span.
  if (customResolved !== undefined && !aborted) {
    const phase = await runCustomRules(customRules, customResolved, classifier, () => aborted);
    for (const event of phase.events) yield event;
    if (phase.fatal) aborted = true;
  }
}

/**
 * Path-list entries that produced no walked unit (missing, unreadable, non-source) are SIGNAL,
 * never silence: one note names each, the run continues around them.
 */
function unwalkedListEntryNotes(
  pathsList: readonly string[] | undefined,
  units: readonly Unit[],
): string[] {
  if (pathsList === undefined) return [];
  const unitPaths = new Set(
    units.map((u) => ("path" in u.state ? u.state.path : "")).filter(Boolean),
  );
  return pathsList
    .filter((p) => !unitPaths.has(p))
    .map((p) => `path list entry not found in the walk: ${p}`);
}

/**
 * WALK-FIRST (design rules-context/03): one walk over every file unit BEFORE any classification,
 * inventories (metadata + parent links) retained, trees freed inside walkUnit. Peak memory =
 * metadata-so-far + contents-so-far + one tree, the same profile as the old streaming walk.
 *
 * The walk is a DEPENDENCY of inventory-scoped rules, so it is taken only where a consumer exists:
 * a unit no in-scope rule targets at element level (files-target only) measures from its raw source
 * and is never parsed. Unwalked units read as inventory-less downstream; a WALK_FAILED there is
 * impossible by construction - the failure requires a walked-for file.
 */
async function walkedInventories(
  units: readonly Unit[],
  options: LintOptions,
  rules: readonly Rule[],
  customRules: readonly CustomRule[],
  registry: GrammarRegistry,
  inScopeFor: (rule: Rule | CustomRule, path: string) => boolean,
): Promise<{ walked: Map<number, WalkedUnit>; skippedExtensions: Set<string> }> {
  const skippedExtensions = new Set<string>();
  const walked = new Map<number, WalkedUnit>();
  for (let i = 0; i < units.length; i += FILE_CONCURRENCY) {
    await Promise.all(
      units.slice(i, i + FILE_CONCURRENCY).map(async (unit, j) => {
        if (unit.kind !== "file") return;
        // custom rules resolve their targets from the inventory (element roles only), so any
        // in-scope custom rule needs the walk just like a json-tier element rule
        const needsWalk =
          rules.some(
            (rule) => inScopeFor(rule, unit.state.path) && !judgesWholeUnit(rule, unit.kind),
          ) || customRules.some((rule) => inScopeFor(rule, unit.state.path));
        if (!needsWalk) return;
        const w = await walkUnit(
          unit,
          options.language !== undefined ? { language: options.language, registry } : { registry },
        );
        // a needed-but-grammar-less file is sweep coverage, not an error: name the extension in
        // the coverage note; the unit still classifies whole (files-target rules read raw source)
        if (w.failed !== null && w.failed.startsWith("no grammar mapping")) {
          skippedExtensions.add(unclaimedExtension(unit.state.path));
        }
        walked.set(i + j, w);
      }),
    );
  }
  return { walked, skippedExtensions };
}

/**
 * The retention guard is shape-robust on purpose: if the JSON target ever becomes an array form
 * (the TS grammar already allows one), "files" anywhere in the target still retains.
 */
function targetsFiles(target: Rule["target"]): boolean {
  return Array.isArray(target) ? target.includes("files") : target === "files";
}

/** Each walked unit's inventory by path: custom-target resolution over the completed walk. */
function elementsByPathOf(
  units: readonly Unit[],
  walked: ReadonlyMap<number, WalkedUnit>,
): Map<string, readonly InventoryElement[]> {
  const byPath = new Map<string, readonly InventoryElement[]>();
  for (let i = 0; i < units.length; i++) {
    const w = walked.get(i);
    if (w !== undefined) byPath.set(units[i]!.state.path, w.inventory);
  }
  return byPath;
}

/**
 * The retention decision: content of files with zero selected targets is dropped (logical drop, no
 * re-read) - every file's text stays only when a files-target JSON rule needs it.
 */
function retainTargetedContent(
  units: Unit[],
  walked: ReadonlyMap<number, WalkedUnit>,
  customResolved: ResolvedCustomTargets,
): void {
  const targetPaths = new Set<string>();
  for (const resolved of customResolved.values()) {
    if ("targets" in resolved) for (const t of resolved.targets) targetPaths.add(t.path);
  }
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    if (walked.has(i) && !targetPaths.has(unit.state.path)) {
      units[i] = { kind: unit.kind, state: { ...unit.state, content: "" } };
    }
  }
}

/**
 * One note per skipped element, named the way every element in jint is named (path@L<line>, the
 * finding convention): a count-only note said the run was incomplete, never WHERE or WHAT was
 * skipped. The stable "skipped:" token is the machine-matchable marker — the note channel is plain
 * strings in the report contract, so there is no code field to match on.
 */
function oversizedSkipNote(path: string, skipped: OversizedElement): string {
  return (
    `${path}@L${skipped.span.start.line}` +
    ` skipped: ${skipped.capture} '${skipped.label}'` +
    ` — ${skipped.chars} chars (over the ${MAX_ELEMENT_TOKENS}-token cap)`
  );
}

/**
 * One pass, no candidacy: every measurement is a reading; the rule's handle is the only threshold.
 * Element readings carry their span into the finding's location. The criteria legend echo is gone
 * (owner contract change): classifier-adjacent rubric prose never reaches findings. The note is the
 * rule AUTHOR's message attached at the fired handle tier, or nothing - default rules carry no
 * messages (authoring them is a separate calibration pass).
 */
function findingFor(
  event: ValuedMeasurement,
  element: Element | undefined,
  handle: Rule["handle"] | undefined,
): Finding | undefined {
  // custom-tier events run their own policy pipeline; a rule outside the JSON map has no
  // finding policy here.
  if (handle === undefined) return undefined;
  // the full answer flows to the handle: score resolution reads value (DEFAULT round) and
  // carries probabilities for future reads
  const outcome = handle(event);
  if (outcome === null) return undefined;
  return {
    rule: event.rule,
    input: event.input,
    value: event.value,
    severity: outcome.severity,
    note: outcome.message,
    undecided: outcome.undecided,
    probabilities: event.probabilities,
    choice: event.choice,
    // Literal ternary branches, NOT conditional spreads: this literal sits under
    // excess-property checking — an undeclared field is a compile error.
    location: element !== undefined ? { input: event.input, span: element.span } : undefined,
  };
}

/**
 * One unit's streamed outcome, in run order: oversized skips, the classifier's own notes, then
 * measurements - each reading that crosses its rule's handle becoming a finding.
 */
function* unitOutcomeEvents(
  result: UnitResult,
  unit: Unit,
  byName: ReadonlyMap<string, Rule>,
  options: LintOptions,
): Generator<LintEvent> {
  const path = "path" in unit.state ? unit.state.path : "unit";
  for (const skipped of result.oversized) {
    yield { type: "note", note: oversizedSkipNote(path, skipped) };
  }
  for (const note of result.notes) {
    yield { type: "note", note };
  }
  for (const { event, element } of result.events) {
    if (event instanceof ClassifyError) {
      yield { type: "error", error: withLanguageHint(event, options) };
      continue;
    }
    yield { type: "measurement", measurement: { ...event, element } };
    // A refused reading has no value: no handle reads it, no finding follows.
    if (event.refused) continue;
    const finding = findingFor(event, element, byName.get(event.rule)?.handle);
    if (finding !== undefined) yield { type: "finding", finding };
  }
}

/**
 * Element scope: files-target rules are claims about the FILE, never one element — they cannot run
 * scoped. An explicitly-named one is a caller contradiction (say so); otherwise they are silently
 * out of the scoped set, like any rule whose target misses the subject.
 */
function scopeElementRules(rules: readonly Rule[], options: LintOptions): readonly Rule[] {
  if (options.element === undefined) return rules;
  const whole = rules.filter((rule) => judgesWholeUnit(rule, "file"));
  if (whole.length === 0) return rules;
  const demanded = new Set(whole.map((rule) => rule.name));
  const named = (options.only ?? []).find((name) => demanded.has(name));
  if (named !== undefined)
    throw new SetupError(
      "ELEMENT_NOT_FOUND",
      `rule ${named} judges whole files, not elements - element-scoped runs take inventory-scoped rules`,
    );
  return rules.filter((rule) => !judgesWholeUnit(rule, "file"));
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
  oversized: readonly OversizedElement[];
  notes: string[];
}

async function runUnit(
  unit: Unit,
  rules: readonly Rule[],
  classifier: Classifier,
  isAborted: () => boolean,
  language: string | undefined,
  registry: GrammarRegistry,
  walked: WalkedUnit | undefined,
  configAdmits: boolean,
): Promise<UnitResult> {
  const result = await classifyFile(
    unit,
    rules,
    classifier,
    isAborted,
    {
      language,
      registry,
      // the walk-union gate: unscoped rules follow the config scope (see Admission)
      configAdmits,
    },
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

/**
 * The sweep-coverage line, lint's own rendering of a walk's unclaimed files: what parses, then what
 * was seen and skipped - ONE note, extensions not paths, sorted (the capture verb instead emits one
 * raw skip event per skipped file; its callers fold). The "parses" side is the RUN's registry: what
 * a run can parse is what its registry claims.
 */
function sweepCoverageNote(unclaimed: Iterable<string>, registry: GrammarRegistry): string {
  const skipped = [...new Set(unclaimed)].sort();
  return (
    "parsing " +
    grammarExtensions(registry).join(", ") +
    " · not parsed (no grammar): " +
    skipped.join(", ")
  );
}

/**
 * One run's input resolution: the units, the walk's admission scopes (config + rule includes -
 * run.input attribution), and the config-scope predicate unscoped rules follow. `configAdmits` is
 * always-true ONLY for str and the paths list (no path semantics to evaluate); dir walks and file
 * operands (including element scope) evaluate the one predicate on their paths.
 */
interface Admission {
  readonly units: Unit[];
  readonly configAdmits: (path: string) => boolean;
  readonly scopes: readonly OwnedScope[];
}

/**
 * The changeset form, entry by entry: a missing, unreadable, or non-source path degrades to a
 * not-in-the-walk note (the caller names it below) - never a failed run.
 */
async function unitsFromPathsList(pathsList: readonly string[]): Promise<Unit[]> {
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
        ["ENTRYPOINT_NOT_FOUND", "ENTRYPOINT_UNREADABLE", "MISSING_GRAMMAR"].includes(thrown.code)
      ) {
        continue;
      }
      throw thrown;
    }
  }
  return resolved;
}

/**
 * FILE-OPERAND SCOPES: the same one predicate as the walk, evaluated on each named path instead of
 * by the walker. A named file behind the config scope is measured by unscoped rules exactly as a
 * walked file is; a rule scope claims its files across the config exclude, as in the walk. The
 * denylist is a SAFETY scope, not a selector: naming a secret-shaped path does not hand its
 * contents to the classifier (pattern-level test; the PEM sniff stays walk-only - a named file with
 * an innocent name is explicit consent, like piped source).
 */
function admittedOperands(
  named: readonly string[],
  options: LintOptions,
  scopes: readonly OwnedScope[],
  configAdmits: (p: string) => boolean,
  stats: InputStats,
  onWalkNote: (note: string) => void,
): string[] {
  // the ONE claim test (the same claim predicate the walk uses - never a second
  // predicate): a rule claims the file when its include names it AND its own exclude does not
  // subtract it. Attribution rides the same answer: the claiming scope is the admitting scope.
  const claimingScope = (p: string): OwnedScope | undefined =>
    scopes.find((scope) => ruleScopeClaims(scope, p));
  const kept: string[] = [];
  for (const path of named) {
    const denied = denylistMatch(path, options.config.secretDenylist ?? SECRET_DENYLIST);
    if (denied !== null) {
      onWalkNote(
        `secret denylist skipped '${path}' (named operand; pattern '${denied}') - naming a secret-shaped path does not hand its contents to the classifier`,
      );
      continue;
    }
    const claim = claimingScope(path);
    if (!configAdmits(path) && claim === undefined) {
      // the no-claim note names the emptiness; the operand still RESOLVES below - existence
      // and grammar failures stay the caller's error, the scopes only decide which rules may
      // measure (a resolve failure REPLACES this note: explicit consent, one hard error)
      onWalkNote(
        `${path}: no rule measures this file - outside the config scope and no rule claims it`,
      );
    }
    // scope attribution for operands (run.input.admitted decomposes `included`): the config
    // scope when it admits, else the claiming rule scope - the same first-match order as the walk
    stats.tallyAdmit(configAdmits(path) ? "config" : (claim?.by ?? "config"));
    kept.push(path);
  }
  return kept;
}

/**
 * The run's units, from whichever input form selected them. The changeset form defers per entry:
 * the list IS the judged subject, so a missing or non-source entry degrades to a not-in-the-walk
 * note instead of failing the run. (An empty list never reaches here: the guard above the auth gate
 * threw LIST_EMPTY.)
 */
async function resolveRunUnits(
  options: LintOptions,
  pathsList: readonly string[] | undefined,
  input: string | string[] | undefined,
  rules: readonly Rule[],
  customRules: readonly CustomRule[],
  registry: GrammarRegistry,
  onWalkNote: (note: string) => void,
  stats: InputStats,
): Promise<Admission> {
  if (options.str !== undefined)
    return {
      units: [strUnit(options.str.content, options.str.path)],
      configAdmits: () => true,
      scopes: [],
    };
  if (pathsList !== undefined && (input === undefined || input === "")) {
    return { units: await unitsFromPathsList(pathsList), configAdmits: () => true, scopes: [] };
  }
  const exclude = [...options.config.exclude, ...(options.exclude ?? [])];
  // WALK-UNION: discovery admits a file when the config include OR any rule's include matches
  // (the walk-union scope build puts the config scope first, so attribution names a rule scope only
  // when the config scope did not admit). Each rule still measures only files its own scope admits.
  const scopes = walkScopes(options.config.include, [...rules, ...customRules]);
  // THE ONE config-scope test (include ∧ ¬exclude), the same predicate for
  // every input kind below. str and paths-list inputs returned above with always-true (no path
  // semantics to evaluate: the paths list is caller-curated selection, str has no real path);
  // dir walks and file operands both use THIS one - the input kind decides where the predicate
  // runs (the walker enforces it mid-walk for dirs; the operand branch evaluates it on the
  // named path), never what it means.
  const configAdmits = configScopeAdmits(options.config.include, exclude);
  const elementPinned = options.element !== undefined;
  const resolvedKind =
    Array.isArray(input) || elementPinned
      ? "file"
      : (options.inputType ?? options.config.inputType ?? (await inferKind(input as string)));
  // one resolution plumbing: the scopes/exclude params ride along (inert on file operands -
  // a named file never walks), load-bearing on the dir walk
  const resolve = (inp: string | string[], inputType: InputKind | undefined) =>
    collectUnits(
      resolveInput({
        input: inp,
        inputType,
        exclude,
        include: scopes,
        scopeBase: options.scopeBase,
        secretDenylist: options.config.secretDenylist,
        onNote: onWalkNote,
        registry,
        requireGrammarFor: (p) =>
          customRules.some((rule) => ruleInScope(rule, p)) ||
          rules.some((rule) => ruleInScope(rule, p) && !judgesWholeUnit(rule, "file")),
        stats,
      }),
    );
  if (resolvedKind === "file") {
    const named = Array.isArray(input)
      ? [...input]
      : [elementPinned ? options.element!.path : (input as string)];
    const kept = admittedOperands(named, options, scopes, configAdmits, stats, onWalkNote);
    const units = kept.length === 0 ? [] : await resolve(kept, "file");
    return { units, configAdmits, scopes };
  }
  // the dir walk: the walker enforces the same scopes mid-walk (admitting through any scope);
  // configAdmits here is what unscoped rules ride during rule selection
  const units = await resolve(
    input as string | string[],
    options.inputType ?? options.config.inputType,
  );
  return { units, configAdmits, scopes };
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

/**
 * The nearest known name within a typo's distance (<= max(2, a third of the guess)); undefined when
 * no candidate is close — a legitimate no-suggestion. Distance computation ONLY: the detail carries
 * the data, the consumer's emitter renders the prose.
 */
export function closestName(name: string, known: ReadonlySet<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of known) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== undefined && bestDistance <= Math.max(2, Math.floor(name.length / 3))
    ? best
    : undefined;
}

/** The unknown-name SetupError with its structured detail: the valid vocabulary + closest match. */
function unknownRuleError(name: string, known: ReadonlySet<string>): SetupError {
  const suggest = closestName(name, known);
  return new SetupError("CONFIG_INVALID", `unknown rule "${name}"`, {
    detail: {
      kind: "unknown-rule",
      valid: [...known],
      suggest,
    },
  });
}

/**
 * The pure selection half of rule partitioning: disable/only set membership, nothing more. No
 * validation, no throw — shared by the run (after it validates) and the CLI's rules pre-print, so
 * the block always shows exactly the set the run will classify.
 */
export function selectRules(
  jsonRules: readonly Rule[],
  customRules: readonly CustomRule[],
  disable: readonly string[] | undefined,
  only: readonly string[] | undefined,
): { json: Rule[]; custom: CustomRule[] } {
  const disabled = disable !== undefined && disable.length > 0 ? new Set(disable) : null;
  const wanted = only !== undefined && only.length > 0 ? new Set(only) : null;
  const keep = (rule: { name: string }): boolean =>
    (disabled === null || !disabled.has(rule.name)) && (wanted === null || wanted.has(rule.name));
  return { json: jsonRules.filter(keep), custom: customRules.filter(keep) };
}

function partitionRules(
  jsonRules: readonly Rule[],
  customRules: readonly CustomRule[],
  disable: readonly string[] | undefined,
  only: readonly string[] | undefined,
): { json: Rule[]; custom: CustomRule[] } {
  validateRuleSelection(jsonRules, customRules, disable, only);
  return selectRules(jsonRules, customRules, disable, only);
}

/**
 * The validation half of partitionRules, shared with the CLI's pre-flight: an unknown disable/only
 * name throws before the rubric pre-print, so the error is never buried under the block.
 */
export function validateRuleSelection(
  jsonRules: readonly Rule[],
  customRules: readonly CustomRule[],
  disable: readonly string[] | undefined,
  only: readonly string[] | undefined,
): void {
  const known = new Set([...jsonRules, ...customRules].map((rule) => rule.name));
  for (const name of disable ?? []) if (!known.has(name)) throw unknownRuleError(name, known);
  for (const name of only ?? []) if (!known.has(name)) throw unknownRuleError(name, known);
}

/**
 * The run pointer: the run-store dir this run's captures landed in, and its id (the dir name).
 * id/dir are present exactly when a classifier call started a run; run.input (the input accounting)
 * rides whenever a walk happened - a capture-less run reports input alone.
 */
export interface RunPointer {
  id?: string;
  dir?: string;
  /** The input accounting (run.input): how many files, and why not all were measured. */
  input?: InputSummary;
}

export interface LintReport {
  measurements: Measurement[];
  findings: Finding[];
  /** Per-unit failures of the request to the classifier: the unit produced no measurement. */
  errors: ClassifyError[];
  /** In-band degradation notes (oversized elements skipped): counted in the run summary. */
  notes: string[];
  /** The self-description of every rule that ran (defaults + config-authored). */
  rules: RuleDigest[];
  /**
   * The run pointer (recording is always on; absent only when no classifier call started a run — a
   * report without captures). Consumers join findings to judged text via run.dir's captures
   * (finding.input == capture state.id); identity itself comes from the URL/dir, never this field.
   */
  run?: RunPointer;
  /**
   * The element-scoped selection's resolved units (path@L runs): WHICH element each selector
   * captured, wire-shaped. Absent on unscoped runs - a walk judges many units, none "selected".
   */
  selected?: SelectedElement[];
}

/** Drain the stream into the stable report shape both reporters render. */
export async function collectReport(events: AsyncIterable<LintEvent>): Promise<LintReport> {
  const report: LintReport = { measurements: [], findings: [], errors: [], notes: [], rules: [] };
  let inputSummary: InputSummary | null = null;
  for await (const event of events) {
    if (event.type === "measurement") report.measurements.push(event.measurement);
    else if (event.type === "finding") report.findings.push(event.finding);
    else if (event.type === "error") report.errors.push(event.error);
    else if (event.type === "note") report.notes.push(event.note);
    else if (event.type === "rules") report.rules = event.rules;
    else if (event.type === "input") inputSummary = event.summary;
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
      // refused readings sort after valued ones
      (a.refused ? 1 : 0) - (b.refused ? 1 : 0) ||
      (a.refused || b.refused ? 0 : a.value - b.value),
  );
  report.errors.sort(
    (a, b) =>
      idFile(a.input).localeCompare(idFile(b.input)) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message) ||
      a.input.localeCompare(b.input),
  );
  report.notes.sort((a, b) => a.localeCompare(b));
  // The run pointer is read AFTER the drain: recording starts at the FIRST classifier call, which
  // happens inside the drained events — reading it before would see null on every run.
  const summary = recordSummary();
  if (summary !== null) report.run = { id: summary.dir.split("/").pop()!, dir: summary.dir };
  // The input accounting rides the run pointer when one exists; a capture-less run still reports
  // it (id/dir absent, input present) - the accounting is about the input, not the classifier.
  if (inputSummary !== null) {
    report.run =
      summary !== null ? { ...report.run!, input: inputSummary } : { input: inputSummary };
  }
  return report;
}
